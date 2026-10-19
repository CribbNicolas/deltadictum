import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { extractTraces, runEvents } from '../../../src/eval/bench/layer1/extract.js';
import { MUTATIONS, mutateRun } from '../../../src/eval/bench/layer1/mutate.js';
import { layer1Summary } from '../../../src/eval/bench/layer1/metrics.js';
import { replay } from '../../../src/eval/v2bench/replay.js';

const RUNS = fileURLToPath(new URL('../../fixtures/bench/layer1/', import.meta.url));
const TASKS = [
  { id: 'tg-dedup', project: 'tollgate', kind: 'memory', situation: 'S15', memories: ['intake/dedup-window-72h'], prompt: 'Bound the dedup set.' },
  { id: 'lk-summary', project: 'ledgerkit', kind: 'memory', situation: 'S10', memories: ['report/no-print', 'report/totals'], prompt: 'Add a summary.' },
];
const row = (run_id, task, condition, model, requirements) => ({ run_id, task, condition, model, requirements });
const sources = () => [
  { runsDir: RUNS, judge: { judgments: [{ run_id: 'tg-win-dd2-0', requirements: { tested: true } }, { run_id: 'tg-quiet-none-0', error: 'timeout', requirements: { tested: false } }] },
    rows: [row('tg-win-dd2-0', 'tg-dedup', 'dd2', 'claude-haiku-5-5', { window_kept: false }), row('tg-quiet-none-0', 'tg-dedup', 'none', 'claude-haiku-5-5', {}),
      row('tg-win-dd2-0', 'tg-dedup', 'dd2', 'claude-haiku-5-5', { window_kept: true }), row('tg-gone-none-0', 'tg-dedup', 'none', 'claude-haiku-5-5', {})] },
  { runsDir: RUNS, rows: [row('lk-posix-doc-0', 'lk-summary', 'doc', 'claude-opus-5-5', { printed: true }), row('tg-win-dd2-0', 'tg-dedup', 'dd2', 'claude-opus-5-5', {})] },
];
const extract = () => extractTraces({ sources: sources(), tasks: TASKS });
const eventPaths = fixture => fixture.runs.flatMap(run => run.events.flatMap(event => event.paths));

test('traces are grouped by project, sorted, and their paths are repository-relative', async () => {
  const traces = await extract();
  assert.deepEqual([...traces.keys()].sort(), ['ledgerkit', 'tollgate']);
  const tollgate = traces.get('tollgate');
  assert.equal(tollgate.version, 2);
  assert.equal(tollgate.project, 'tollgate');
  assert.deepEqual(tollgate.tasks, { 'tg-dedup': { kind: 'memory', situation: 'S15', memories: ['intake/dedup-window-72h'] } });
  const ids = tollgate.runs.map(run => run.run_id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(ids, ['claude-haiku-5-5/tg-quiet-none-0', 'claude-haiku-5-5/tg-win-dd2-0', 'claude-opus-5-5/tg-win-dd2-0']);
  const win = tollgate.runs.find(run => run.run_id === 'claude-haiku-5-5/tg-win-dd2-0');
  assert.equal(win.model, 'claude-haiku-5-5');
  assert.equal(win.task, 'tg-dedup');
  assert.equal(win.condition, 'dd2');
  // The last row of a run wins (a recheck), and the judge's verdicts join the row's.
  assert.deepEqual(win.verdicts, { window_kept: true, tested: true });
  assert.deepEqual(win.events.map(e => [e.kind, e.paths]), [
    ['prompt', []], ['read', ['internal/intake/dedup.go']], ['read', []], ['search', ['internal']],
    ['edit', ['internal/intake/dedup.go']], ['run', ['.', 'internal/intake']]]);
  for (const path of [...eventPaths(tollgate), ...eventPaths(traces.get('ledgerkit'))]) {
    assert.doesNotMatch(path, /[:\\]|dd-bench-/, path);
  }
  const text = JSON.stringify([...traces.values()]);
  assert.doesNotMatch(text, /[A-Za-z]:[\\/]|Users[\\/]|\/home\/|dd-bench-/);
  assert.equal(traces.get('ledgerkit').runs[0].added['ledgerkit/summary.py'], "print('total')\n");
  assert.deepEqual(Object.keys(traces.get('ledgerkit').runs[0].added), ['ledgerkit/summary.py']);
});

test('a run with no tool call keeps its prompt event', async () => {
  const quiet = (await extract()).get('tollgate').runs.find(run => run.run_id.endsWith('tg-quiet-none-0'));
  assert.deepEqual(quiet.events, [{ kind: 'prompt', paths: [], text: 'Bound the dedup set.' }]);
  assert.deepEqual(quiet.added, {});
});

test('extracting twice gives the same bytes', async () => {
  const bytes = traces => gzipSync(JSON.stringify(traces.get('tollgate')));
  assert.deepEqual(bytes(await extract()), bytes(await extract()));
});

test('a stream without an init event finds its clone from a tool path', () => {
  const stream = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/tmp/dd-bench-q1/tollgate/cmd/main.go' } }] } });
  assert.deepEqual(runEvents(stream).events, [{ kind: 'read', paths: ['cmd/main.go'] }]);
});

const ev = (kind, path) => ({ kind, paths: path ? [path] : [] });
const sample = () => ({ run_id: 'm/r-0', model: 'm', task: 't', condition: 'dd2', verdicts: {}, added: {}, events: [
  { kind: 'prompt', paths: [], text: 'Do it.' }, ev('read', 'a/one.go'), ev('search', 'a'), ev('read', 'b/two.go'), ev('run', 'Makefile'),
  ev('read', 'c/three.go'), ev('read', 'd/four.go'), ev('edit', 'a/one.go'), ev('read', 'e/five.go'), ev('write', 'a/new.go')] });

test('the mutations are the four the plan names, and none only renames the run', () => {
  assert.deepEqual(MUTATIONS, ['none', 'no-prompt', 'reads-shuffled', 'sibling-paths']);
  const run = sample();
  const same = mutateRun(run, 'none', 1);
  assert.equal(same.run_id, 'm/r-0~none');
  assert.deepEqual(same.events, run.events);
  assert.throws(() => mutateRun(run, 'paraphrase', 1), /unknown mutation/);
});

test('no-prompt drops only the prompt event', () => {
  const run = sample();
  const out = mutateRun(run, 'no-prompt', 1);
  assert.equal(out.run_id, 'm/r-0~no-prompt');
  assert.deepEqual(out.events, run.events.slice(1));
  assert.equal(run.events.length, 10, 'the input run is left alone');
});

test('reads-shuffled keeps every edit, write and run where it was, and the same seed gives the same order', () => {
  const run = sample();
  const out = mutateRun(run, 'reads-shuffled', 7);
  out.events.forEach((event, i) => { if (!['read', 'search'].includes(event.kind) || i > 7) assert.deepEqual(event, run.events[i]); });
  const before = events => events.slice(0, 7).filter(e => ['read', 'search'].includes(e.kind)).map(e => e.paths[0]);
  assert.deepEqual([...before(out.events)].sort(), [...before(run.events)].sort());
  assert.deepEqual(mutateRun(run, 'reads-shuffled', 7).events, out.events);
  const orders = new Set([1, 2, 3, 4, 5, 6, 7, 8].map(seed => JSON.stringify(before(mutateRun(run, 'reads-shuffled', seed).events))));
  assert.ok(orders.size > 1, 'different seeds give different orders');
});

test('sibling-paths renames files and keeps their folders', () => {
  const out = mutateRun({ ...sample(), events: [ev('read', 'a/one.go'), ev('search', 'a'), ev('run', 'Makefile'), ev('write', 'top.md'), { kind: 'run', paths: ['.', 'x/y.test.js'] }] }, 'sibling-paths', 1);
  assert.deepEqual(out.events.map(e => e.paths), [['a/zz-sibling-one.go'], ['a'], ['Makefile'], ['zz-sibling-top.md'], ['.', 'x/zz-sibling-y.test.js']]);
});

const memory = (id, topic, triggers, over = {}) => ({ id, topic, status: 'active', title: topic, body: `Body ${topic}.`, triggers, ...over });
const readsOf = path => [{ on: ['read', 'edit'], paths: [path] }];
const summaryFixture = runs => ({ version: 2, project: 'p', runs, tasks: {
  two: { kind: 'memory', situation: 'S1', memories: ['k/a', 'k/b'] },
  checked: { kind: 'memory', situation: 'S2', memories: ['k/check'] },
  ctl: { kind: 'control', situation: 'S3', memories: [] } } });
const trace = (run_id, task, condition, events) => ({ run_id, model: 'm', task, condition, events, verdicts: {}, added: {} });

test('a task with two key memories counts as delivered only when both arrive', () => {
  const memories = [memory('A', 'k/a', readsOf('a.go')), memory('B', 'k/b', readsOf('b.go')), memory('N', 'noise', readsOf('n.go'))];
  const runs = [
    trace('m/both~none', 'two', 'dd2', [ev('read', 'a.go'), ev('read', 'b.go'), ev('edit', 'a.go')]),
    trace('m/one~none', 'two', 'dd2', [ev('read', 'a.go'), ev('read', 'n.go'), ev('edit', 'a.go')]),
    trace('m/late~none', 'two', 'dd2', [ev('read', 'a.go'), ev('edit', 'a.go'), ev('read', 'b.go')]),
    trace('m/ctl~none', 'ctl', 'dd2', [ev('read', 'n.go')]),
    trace('m/both~no-prompt', 'two', 'none', [ev('read', 'a.go')]),
  ];
  const fixture = summaryFixture(runs);
  const summary = layer1Summary(fixture, replay(fixture, memories), memories);
  assert.deepEqual(Object.keys(summary).sort(), ['no-prompt', 'none']);
  assert.deepEqual(summary.none.dd2, { runs: 4, key_runs: 3, keys_delivered_pct: 67, keys_before_edit_pct: 33, keys_partial: 1, median_noise: 0, untriggered: [] });
  assert.equal(summary['no-prompt'].none.keys_partial, 1);
  assert.equal(summary['no-prompt'].none.keys_delivered_pct, 0);
});

test('a memory with a check and no trigger is listed, not counted as missed', () => {
  const memories = [memory('C', 'k/check', [], { check: { when: 'turn', if_content: 'print\(' } }), memory('A', 'k/a', readsOf('a.go'))];
  const fixture = summaryFixture([trace('m/c~none', 'checked', 'dd2', [ev('read', 'a.go'), ev('edit', 'a.go')])]);
  const summary = layer1Summary(fixture, replay(fixture, memories), memories);
  assert.deepEqual(summary.none.dd2, { runs: 1, key_runs: 0, keys_delivered_pct: null, keys_before_edit_pct: null, keys_partial: 0, median_noise: 1, untriggered: ['k/check'] });
});
