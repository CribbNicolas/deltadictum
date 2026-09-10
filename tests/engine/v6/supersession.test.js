import { describe, test } from 'node:test';
import assert from 'node:assert';
import { decideSupersession } from '../../../src/engine/v6/supersession.js';

const existing = {
  id: 'old-1',
  behavior_delta: 'Use port 8080 for reasoning',
  what: 'Reasoning model listens on 8080',
  why: 'compose mapping',
};

describe('V6 supersession decision', () => {
  test('explicit supersedes intent forces supersede', () => {
    const result = decideSupersession(existing, { ...existing, supersedes: 'old-1' });
    assert.strictEqual(result.action, 'supersede');
  });

  test('material change in behavior_delta -> supersede', () => {
    const result = decideSupersession(existing, { ...existing, behavior_delta: 'Use port 9090 for reasoning' });
    assert.strictEqual(result.action, 'supersede');
  });

  test('material change in what -> supersede', () => {
    const result = decideSupersession(existing, { ...existing, what: 'Reasoning model listens on 9090' });
    assert.strictEqual(result.action, 'supersede');
  });

  test('no material change -> update (no-op insert)', () => {
    const result = decideSupersession(existing, { ...existing });
    assert.strictEqual(result.action, 'update');
  });
});
