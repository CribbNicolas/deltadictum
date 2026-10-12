import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoAcceptEnabled, autoAcceptReasons } from '../../src/capture/auto-accept.js';

const memory = { replaces: null };
const ok = { memory, verified: { files: 1, corrections: 0 }, warnings: [], duplicateOf: null, enabled: true };

test('a candidate with verified evidence, live triggers, no check, no duplicate and no revision activates', () => {
  assert.deepEqual(autoAcceptReasons(ok), []);
  assert.deepEqual(autoAcceptReasons({ ...ok, verified: { files: 0, corrections: 1 } }), []);
});

test('each unmet condition is named', () => {
  assert.deepEqual(autoAcceptReasons({ ...ok, verified: { files: 0, corrections: 0 } }), ['no_verified_evidence']);
  assert.deepEqual(autoAcceptReasons({ ...ok, warnings: [{ kind: 'dead_glob' }] }), ['dead_trigger']);
  assert.deepEqual(autoAcceptReasons({ ...ok, memory: { ...memory, check: {} } }), ['has_check']);
  assert.deepEqual(autoAcceptReasons({ ...ok, duplicateOf: 'x' }), ['suspected_duplicate']);
  assert.deepEqual(autoAcceptReasons({ ...ok, memory: { replaces: 'y' } }), ['revision']);
  assert.deepEqual(autoAcceptReasons({ ...ok, enabled: false }), ['auto_accept_disabled']);
});

test('auto-accept is on unless the project turns it off', () => {
  assert.equal(autoAcceptEnabled({}), true);
  assert.equal(autoAcceptEnabled({ auto_accept: { enabled: true, confidence_threshold: 0.765 } }), true);
  assert.equal(autoAcceptEnabled({ auto_accept: false }), false);
  assert.equal(autoAcceptEnabled({ auto_accept: { enabled: false } }), false);
});
