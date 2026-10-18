import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootstrapMean, pairedDiffs, random, schedule, shuffle } from '../../../src/eval/bench/stats.js';

test('the generator is deterministic per seed', () => {
  const a = random(7), b = random(7), c = random(8);
  const first = [a(), a(), a()];
  assert.deepEqual(first, [b(), b(), b()]);
  assert.notDeepEqual(first, [c(), c(), c()]);
  assert.ok(first.every(v => v >= 0 && v < 1));
});

test('shuffle keeps every element and does not touch the input', () => {
  const list = [1, 2, 3, 4, 5, 6];
  const out = shuffle(list, random(1));
  assert.deepEqual([...out].sort(), list);
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6]);
});

test('the schedule is repetition-major, shuffled within a repetition, and skips done runs', () => {
  const tasks = [{ id: 'p-a' }, { id: 'p-b' }];
  const jobs = schedule(tasks, ['dd2', 'none'], 2, new Set(['p-a-none-1']), 3);
  assert.equal(jobs.length, 7);
  assert.ok(jobs.slice(0, 4).every(([, , i]) => i === 0));
  assert.ok(!jobs.some(([t, c, i]) => t.id === 'p-a' && c === 'none' && i === 1));
  assert.deepEqual(schedule(tasks, ['dd2', 'none'], 2, new Set(), 3).map(([t, c, i]) => `${t.id}${c}${i}`),
    schedule(tasks, ['dd2', 'none'], 2, new Set(), 3).map(([t, c, i]) => `${t.id}${c}${i}`));
});

test('paired differences use only tasks with values in both conditions', () => {
  const rows = [
    { task: 't1', condition: 'dd2', q: 1 }, { task: 't1', condition: 'dd2', q: 0 }, { task: 't1', condition: 'none', q: 0 },
    { task: 't2', condition: 'dd2', q: 1 }, { task: 't2', condition: 'none', q: null },
    { task: 't3', condition: 'none', q: 1 },
  ];
  assert.deepEqual(pairedDiffs(rows, 'dd2', 'none', r => r.q), [0.5]);
});

test('the bootstrap interval brackets the mean and is reproducible', () => {
  const values = [0.5, 0.25, 0, 0.75, 0.5, 0.5, 1, 0.25];
  const out = bootstrapMean(values, { seed: 2 });
  assert.equal(out.n, 8);
  assert.equal(out.mean, 0.46875);
  assert.ok(out.ci95[0] <= out.mean && out.mean <= out.ci95[1]);
  assert.deepEqual(bootstrapMean(values, { seed: 2 }), out);
  assert.deepEqual(bootstrapMean([]), { n: 0, mean: null, ci95: null });
});
