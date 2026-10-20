import { test } from 'node:test';
import assert from 'node:assert/strict';
import { averageSummaries, formatChange, formatValue, tableFor, validateSummary } from '../src/lib/bench.js';

const SUMMARY = {
  schema: 1, id: 't1', date: '2026-10-14', title: 'Trial', model: 'm', tasks: 10, runs_per_condition: 1, judge: 'j', report: 'benchmarks/t1.md', caveat: 'Small.',
  base: 'none',
  conditions: [{ id: 'none', label: 'Agent alone' }, { id: 'docref', label: 'With documentation' }, { id: 'docdd', label: 'With documentation + DD' }],
  metrics: [
    { id: 'quality', label: 'Code quality', unit: 'pct', better: 'higher', values: { none: 70, docref: 72, docdd: 77 }, ci95: { none: [60, 80], docref: [62, 81], docdd: [68, 85] } },
    { id: 'context', label: 'Context', unit: 'tokens', better: 'lower', values: { none: 27200, docref: 31000, docdd: 27200 } },
    { id: 'cost', label: 'Cost per task', unit: 'usd', better: 'lower', values: { none: 0.09, docref: 0.1, docdd: 0.08 } },
    { id: 'errors', label: 'Errors', unit: 'pct', better: 'lower', values: { none: 0, docref: 0, docdd: 10 } },
  ],
};

test('values read in their unit', () => {
  assert.equal(formatValue(77, 'pct'), '77%');
  assert.equal(formatValue(27200, 'tokens'), '27.2k tokens');
  assert.equal(formatValue(0.09, 'usd'), '$0.090');
});

// The change is read off the values as the table shows them, so the two always agree: a percentage changes
// by points (56% to 99% is +43 pts, not +77%), context and cost by their share of the base.
test('a percentage changes by points between the values shown', () => {
  assert.deepEqual(formatChange(99, 56, 'pct', 'higher'), { text: '+43 pts', better: true });
  assert.deepEqual(formatChange(99.5, 93.6, 'pct', 'higher'), { text: '+6 pts', better: true });
  assert.deepEqual(formatChange(99.0, 93.6, 'pct', 'higher'), { text: '+5 pts', better: true });
  assert.deepEqual(formatChange(70.2, 70, 'pct', 'higher'), { text: '+0 pts', better: null });
  assert.deepEqual(formatChange(10, 0, 'pct', 'lower'), { text: '+10 pts', better: false });
});

test('context and cost change by their share of the base, between the values shown', () => {
  assert.deepEqual(formatChange(47300, 42000, 'tokens', 'lower'), { text: '+13%', better: false });
  assert.deepEqual(formatChange(27200, 27240, 'tokens', 'lower'), { text: '+0%', better: null });
  assert.deepEqual(formatChange(0.08, 0.09, 'usd', 'lower'), { text: '-11%', better: true });
  assert.deepEqual(formatChange(0.2294, 0.2236, 'usd', 'lower'), { text: '+2%', better: false });
});

test('context or cost over a base of zero shows the value itself', () => {
  assert.deepEqual(formatChange(0.01, 0, 'usd', 'lower'), { text: '$0.010', better: false });
  assert.deepEqual(formatChange(0, 0, 'usd', 'lower'), { text: '$0.000', better: null });
});

const HIGHLIGHT = { reference: 'docref', contenders: ['docdd'] };

test('the landing table shows every value, with its change against the base beside it', () => {
  const table = tableFor(SUMMARY, HIGHLIGHT);
  assert.deepEqual(table.columns.map(c => [c.label, c.base]), [['Agent alone', true], ['With documentation', false], ['With documentation + DD', false]]);
  assert.deepEqual(table.rows[0].cells.map(c => [c.text, c.change]), [['70%', null], ['72%', '+2 pts'], ['77%', '+7 pts']]);
  assert.deepEqual(table.rows[1].cells.map(c => [c.text, c.change]), [['27.2k tokens', null], ['31.0k tokens', '+14%'], ['27.2k tokens', '+0%']]);
});

test('DD ahead of the documentation is the lead; level with it, both are a gain', () => {
  const table = tableFor(SUMMARY, HIGHLIGHT);
  assert.deepEqual(table.rows.map(r => r.cells.map(c => c.tone)), [
    [null, null, 'lead'],   // quality: 77% beats 72%
    [null, null, 'lead'],   // context: fewer tokens
    [null, null, 'lead'],   // cost: cheaper
    [null, 'gain', null],   // errors: the documentation is ahead
  ]);
  const level = structuredClone(SUMMARY);
  level.metrics[0].values.docdd = 72.4;
  assert.deepEqual(tableFor(level, HIGHLIGHT).rows[0].cells.map(c => c.tone), [null, 'gain', 'gain']);
});

test('without a reference the table colours nothing', () => {
  assert.ok(tableFor(SUMMARY).rows.every(r => r.cells.every(c => c.tone === null)));
});

test('an invalid summary fails, naming the file', () => {
  assert.equal(validateSummary(SUMMARY, 'a.json'), SUMMARY);
  assert.throws(() => validateSummary({ ...SUMMARY, schema: 2 }, 'a.json'), /a\.json: unknown schema 2/);
  assert.throws(() => validateSummary({ ...SUMMARY, base: 'dd' }, 'a.json'), /a\.json: base dd is not a condition/);
  const missing = structuredClone(SUMMARY);
  delete missing.metrics[1].values.docdd;
  assert.throws(() => validateSummary(missing, 'a.json'), /a\.json: context has no value for docdd/);
  const bad = structuredClone(SUMMARY);
  bad.metrics[0].unit = 'ms';
  assert.throws(() => validateSummary(bad, 'a.json'), /a\.json: quality has unit ms/);
});

const MODEL = (id, model, values) => ({
  ...SUMMARY, id, model, date: '2026-10-18',
  conditions: [{ id: 'none', label: 'Agent alone' }, { id: 'docref', label: 'Guide' }, { id: 'doc', label: 'Guide, not referenced' }, { id: 'dd2', label: 'With DD' }],
  metrics: [
    { id: 'quality', label: 'Code quality', unit: 'pct', better: 'higher', values: values.quality, ci95: { none: [1, 2], docref: [1, 2], doc: [1, 2], dd2: [1, 2] } },
    { id: 'cost', label: 'Cost per task', unit: 'usd', better: 'lower', values: values.cost },
  ],
});
const OPUS = MODEL('a', 'opus', { quality: { none: 92, docref: 97, doc: 98, dd2: 97 }, cost: { none: 0.4, docref: 0.5, doc: 0.46, dd2: 0.44 } });
const HAIKU = MODEL('b', 'haiku', { quality: { none: 85, docref: 97, doc: 97, dd2: 94 }, cost: { none: 0.02, docref: 0.02, doc: 0.02, dd2: 0.04 } });
const FEATURED = { title: 'Both models', note: 'Averaged.', trials: ['a', 'b'], merge: { doc: { label: 'With documentation', of: ['docref', 'doc'] } } };

test('the landing summary averages the trials, and the merged conditions within each', () => {
  const summary = averageSummaries([OPUS, HAIKU], FEATURED);
  assert.deepEqual(summary.conditions, [{ id: 'none', label: 'Agent alone' }, { id: 'doc', label: 'With documentation' }, { id: 'dd2', label: 'With DD' }]);
  assert.deepEqual(summary.metrics[0].values, { none: 88.5, doc: 97.25, dd2: 95.5 });
  assert.deepEqual(summary.metrics[1].values, { none: 0.21, doc: 0.25, dd2: 0.24 });
  assert.deepEqual([summary.title, summary.tasks, summary.runs_per_condition, summary.base, summary.models, summary.note], ['Both models', 10, 1, 'none', ['opus', 'haiku'], 'Averaged.']);
  // An interval does not average: the landing shows none.
  assert.equal(summary.metrics[0].ci95, undefined);
  assert.equal(validateSummary(summary, 'averaged'), summary);
});

test('the landing summary refuses trials it cannot average', () => {
  assert.throws(() => averageSummaries([OPUS], { ...FEATURED, trials: ['a', 'c'] }), /no benchmark summary c/);
  assert.throws(() => averageSummaries([OPUS, { ...HAIKU, tasks: 9 }], FEATURED), /b: 9 tasks, a has 10/);
  assert.throws(() => averageSummaries([OPUS, { ...HAIKU, runs_per_condition: 2 }], FEATURED), /b: 2 runs per condition, a has 1/);
  assert.throws(() => averageSummaries([OPUS, { ...HAIKU, metrics: HAIKU.metrics.slice(0, 1) }], FEATURED), /b has no metric cost/);
});
