import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, enrichRow, group } from '../../../src/eval/bench/report.js';
import { summarize } from '../../../src/eval/agent/summary.js';

const hook = (event, context) => JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: event,
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) });
const call = (id, name) => JSON.stringify({ type: 'assistant', message: { id: `m${id}`, usage: { input_tokens: 1000 }, content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = JSON.stringify({ type: 'result', duration_ms: 60000 });
const task = { id: 'p-a', project: 'p', situation: 'S1', origin: 'invented', kind: 'memory', memories: ['x/one'], withheld: ['x/old'], requirements: [{ id: 'rule', auto: true, text: '' }, { id: 'judged', text: '' }] };
const titles = { 'x/one': 'Rule one', 'x/old': 'Old rule' };
const titleOf = (project, topic) => titles[topic] ?? null;
const base = { run_id: 'p-a-dd2-0', task: 'p-a', project: 'p', situation: 'S1', origin: 'invented', kind: 'memory', memories: ['x/one'], withheld: ['x/old'],
  condition: 'dd2', passed: true, suite_passed: true, lint_ok: null, error: null, timed_out: false, requirements: { rule: true }, numstat: '3\t1\ta.go', cost_usd: 0.02 };

test('a run is resolved without lint, and its key memory is timed and applied', () => {
  const stream = [call('r1', 'Read'), hook('PreToolUse', '[TRAP] Rule one - Do it.\n[FACT] Noise - Other.'), call('e1', 'Edit'), result].join('\n');
  const row = enrichRow(base, task, stream, { judged: true, tested: true }, titleOf);
  assert.equal(row.resolved, true);
  assert.equal(row.keys_delivered, true);
  assert.equal(row.key_at, 'before_edit');
  assert.equal(row.applied, true);
  assert.equal(row.withheld_ok, true);
  assert.equal(row.noise, 1);
  assert.equal(row.specific_quality, 1);
  assert.equal(row.lines, 4);
});

test('a delivered superseded memory fails withheld_ok, and lint false fails resolution', () => {
  const stream = [hook('PreToolUse', '[TRAP] Old rule - Old.'), result].join('\n');
  const row = enrichRow({ ...base, lint_ok: false }, task, stream, null, titleOf);
  assert.equal(row.withheld_ok, false);
  assert.equal(row.keys_delivered, false);
  assert.equal(row.key_at, null);
  assert.equal(row.resolved, false);
});

test('groups count key timing and the report pairs dd2 with each condition by task', () => {
  const stream = [call('e1', 'Edit'), hook('PreToolUse', '[TRAP] Rule one - Do it.'), result].join('\n');
  const rows = [];
  for (const [condition, rule, cost] of [['dd2', true, 0.02], ['none', false, 0.03]]) {
    for (const id of ['p-a', 'p-b']) {
      rows.push(enrichRow({ ...base, run_id: `${id}-${condition}-0`, task: id, condition, requirements: { rule }, cost_usd: cost },
        { ...task, id }, condition === 'dd2' ? stream : result, null, titleOf));
    }
  }
  const g = group(rows.filter(r => r.condition === 'dd2'));
  assert.equal(g.key_at.at_edit, 2);
  assert.equal(g.keys_delivered_pct, 100);
  const report = buildReport(rows, ['dd2', 'none'], 'fake');
  assert.equal(report.by_kind.memory.conditions.dd2.specific_quality_pct, 100);
  assert.equal(report.by_situation.S1.conditions.none.specific_quality_pct, 0);
  assert.equal(report.by_project.p.conditions.dd2.runs, 2);
  assert.equal(report.paired.requirements.none.mean, 1);
  assert.equal(report.paired.requirements.none.n, 2);
  assert.ok(Math.abs(report.paired.cost_usd.none.mean + 0.01) < 1e-9);
  assert.match(report.table, /Project requirements met/);
});

test('the site summary reads a bench report', () => {
  const stream = [call('e1', 'Edit'), result].join('\n');
  const rows = ['dd2', 'none'].map(condition => enrichRow({ ...base, condition, run_id: `p-a-${condition}-0` }, task, stream, { judged: true }, titleOf));
  const report = buildReport(rows, ['dd2', 'none'], 'fake');
  const summary = summarize(report, { id: 'x', date: '2026-10-16', title: 'X', base: 'none', compare: ['dd2'], judge: 'j', doc: 'd', caveat: 'c' });
  assert.equal(summary.tasks, 1);
  assert.equal(summary.metrics.find(m => m.id === 'requirements').values.dd2, 100);
});

test('with a judge, a run the judge did not decide is counted and left out of quality', () => {
  const row = enrichRow(base, task, result, null, titleOf, { requireJudge: true });
  assert.equal(row.unjudged, true);
  assert.equal(row.quality, null);
  assert.equal(row.specific_quality, null);
  assert.equal(group([row]).unjudged, 1);
  assert.equal(enrichRow(base, task, result, null, titleOf).unjudged, false);
});
