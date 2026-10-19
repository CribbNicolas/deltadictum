import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { extractTraces, runEvents } from '../../../src/eval/bench/layer1/extract.js';

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
