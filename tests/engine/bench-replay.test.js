import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replay } from '../../src/eval/replay/replay.js';
import { benchMetrics } from '../../src/eval/replay/metrics.js';

const fixture = {
  tasks: { t1: { kind: 'memory', memory: 'a/key' }, t2: { kind: 'control', memory: null }, t3: { kind: 'memory', memory: 'a/key' } },
  runs: [
    { run_id: 'r1', task: 't1', condition: 'none', events: [
      { kind: 'prompt', paths: [], text: 'rename it' }, { kind: 'read', paths: ['src/a.js'] }, { kind: 'edit', paths: ['src/a.js'], text: 'x' },
      { kind: 'read', paths: ['src/a.js'] }] },
    { run_id: 'r2', task: 't2', condition: 'none', events: [{ kind: 'prompt', paths: [], text: 'other' }, { kind: 'read', paths: ['src/c.js'] }] },
    { run_id: 'r3', task: 't3', condition: 'dd', events: [{ kind: 'prompt', paths: [], text: 'go' }, { kind: 'edit', paths: ['src/a.js'], text: 'y' }] },
  ],
};
const memory = (id, topic, triggers, status = 'active') => ({ id, topic, triggers, status, body: 'b'.repeat(40) });
const memories = [
  memory('m-key', 'a/key', [{ on: ['read', 'edit'], paths: ['src/a.js'] }]),
  memory('m-c', 'c/other', [{ on: ['read'], paths: ['src/c.js'] }]),
  memory('m-old', 'z/old', [{ on: ['read'], paths: ['src/a.js'] }], 'archived'),
  memory('m-bare', 'z/bare', []),
];

test('a memory is delivered once per run, at the first event it fires on, never when inactive', () => {
  const results = replay(fixture, memories);
  assert.deepEqual([...results[0].delivered], [['m-key', { at: 1, kind: 'read', via: ['paths'] }]]);
  assert.deepEqual([...results[1].delivered.keys()], ['m-c']);
  assert.deepEqual([...results[2].delivered], [['m-key', { at: 1, kind: 'edit', via: ['paths'] }]]);
});

test('metrics count the key memory, delivery before the first edit, noise, tokens and hubs', () => {
  const { summary, rows } = benchMetrics(fixture, replay(fixture, memories), memories);
  assert.equal(summary.runs, 3);
  assert.equal(summary.memory_runs, 2);
  assert.equal(summary.key_delivered, 2);
  // r3 receives it with the edit itself, after the edit applied: not before.
  assert.equal(summary.key_before_edit, 1);
  assert.deepEqual(rows.map(r => r.noise), [0, 1, 0]);
  assert.deepEqual(rows.map(r => r.tokens), [22, 22, 22]);
  assert.equal(summary.median_tokens, 22);
  assert.equal(summary.zero_token_runs, 0);
  assert.deepEqual(summary.deliveries_by_dimension, { paths: 3 });
  assert.deepEqual(summary.hubs, [{ topic: 'a/key', rate: 67 }, { topic: 'c/other', rate: 33 }]);
  assert.deepEqual(summary.never_fired, ['z/bare']);
  assert.deepEqual(summary.without_triggers, ['z/bare']);
  assert.deepEqual(summary.missed, []);
});
