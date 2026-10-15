import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from '../../src/eval/agent/summary.js';

const group = (over = {}) => ({ runs: 4, resolution_pct: 75, resolution_ci95: [30, 95], quality_pct: 70, quality_ci95: [60, 80],
  specific_quality_pct: 50, specific_quality_ci95: [20, 80], median_peak_context_tokens: 27200, mean_cost_usd: 0.09, ...over });
const report = {
  model: 'claude-test-1', conditions: ['dd2', 'docref', 'none'],
  by_kind: {
    all: { conditions: { none: group(), docref: group({ quality_pct: 72 }), dd2: group({ quality_pct: 77, mean_cost_usd: 0.08 }) } },
    memory: { conditions: { none: group(), docref: group({ specific_quality_pct: 80 }), dd2: group({ specific_quality_pct: 100 }) } },
  },
  by_task: { a: {}, b: {} },
};
const options = { id: 't1', date: '2026-10-14', title: 'Trial', base: 'none', compare: ['docref', 'dd2'], judge: 'claude-judge', doc: 'benchmarks/t1.md', caveat: 'Small.' };

test('a summary carries the trial, its conditions in order and five metrics', () => {
  const s = summarize(report, options);
  assert.equal(s.schema, 1);
  assert.equal(s.model, 'claude-test-1');
  assert.equal(s.tasks, 2);
  assert.equal(s.runs_per_condition, 2);
  assert.deepEqual(s.conditions, [{ id: 'none', label: 'Agent alone' }, { id: 'docref', label: 'With documentation' }, { id: 'dd2', label: 'With DD' }]);
  assert.deepEqual(s.metrics.map(m => m.id), ['resolution', 'quality', 'requirements', 'context', 'cost']);
});

test('project requirements come from the tasks the knowledge bears on, the rest from all tasks', () => {
  const s = summarize(report, options);
  const by = id => s.metrics.find(m => m.id === id);
  assert.deepEqual(by('requirements').values, { none: 50, docref: 80, dd2: 100 });
  assert.deepEqual(by('quality').values, { none: 70, docref: 72, dd2: 77 });
  assert.deepEqual(by('cost').values, { none: 0.09, docref: 0.09, dd2: 0.08 });
  assert.equal(by('cost').better, 'lower');
  assert.deepEqual(by('quality').ci95.none, [60, 80]);
  assert.equal(by('context').ci95, undefined);
});

test('labels can be overridden, and a condition the report lacks is refused', () => {
  assert.equal(summarize(report, { ...options, labels: { dd2: 'With DD v2' } }).conditions[2].label, 'With DD v2');
  assert.throws(() => summarize(report, { ...options, compare: ['docdd'] }), /no condition docdd/);
});

test('a missing value is refused, naming the metric and the condition', () => {
  const broken = structuredClone(report);
  broken.by_kind.all.conditions.dd2.mean_cost_usd = null;
  assert.throws(() => summarize(broken, options), /cost has no value for dd2/);
});
