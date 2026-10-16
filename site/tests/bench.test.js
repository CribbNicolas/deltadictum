import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatChange, formatValue, pickFeatured, tableFor, validateSummary } from '../src/lib/bench.js';

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

test('a change is relative to the base, signed and whole, and knows whether it is better', () => {
  assert.deepEqual(formatChange(77, 70, 'pct', 'higher'), { text: '+10%', better: true });
  assert.deepEqual(formatChange(27200, 27200, 'tokens', 'lower'), { text: '+0%', better: null });
  assert.deepEqual(formatChange(0.08, 0.09, 'usd', 'lower'), { text: '-11%', better: true });
  assert.deepEqual(formatChange(31000, 27200, 'tokens', 'lower'), { text: '+14%', better: false });
  assert.deepEqual(formatChange(70.2, 70, 'pct', 'higher'), { text: '+0%', better: null });
});

test('a base of zero shows the value itself', () => {
  assert.deepEqual(formatChange(10, 0, 'pct', 'lower'), { text: '10%', better: false });
  assert.deepEqual(formatChange(0, 0, 'pct', 'lower'), { text: '0%', better: null });
});

test('the landing table: Base in the base column, changes elsewhere', () => {
  const table = tableFor(SUMMARY);
  assert.deepEqual(table.columns.map(c => [c.label, c.base]), [['Agent alone', true], ['With documentation', false], ['With documentation + DD', false]]);
  assert.deepEqual(table.rows[0].cells.map(c => c.text), ['Base', '+3%', '+10%']);
  assert.deepEqual(table.rows[1].cells.map(c => c.text), ['Base', '+14%', '+0%']);
});

test('the detail table carries values, intervals and changes', () => {
  const row = tableFor(SUMMARY, { detail: true }).rows[0];
  assert.deepEqual(row.cells.map(c => c.text), ['70%', '72%', '77%']);
  assert.deepEqual(row.cells.map(c => c.ci), ['60–80', '62–81', '68–85']);
  assert.deepEqual(row.cells.map(c => c.change ?? null), [null, '+3%', '+10%']);
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

test('the featured trial is the configured one, else the newest', () => {
  const older = { ...SUMMARY, id: 'old', date: '2026-01-01' };
  assert.equal(pickFeatured([older, SUMMARY], 'old').id, 'old');
  assert.equal(pickFeatured([older, SUMMARY], 'missing').id, 't1');
  assert.throws(() => pickFeatured([], 'x'), /no benchmark summary/);
});
