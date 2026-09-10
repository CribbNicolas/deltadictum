import { describe, test } from 'node:test';
import assert from 'node:assert';
import { triggerActivationScore } from '../../../src/engine/v4/trigger-match.js';

describe('V4 trigger activation score', () => {
  test('returns 1 for substring containment either direction', () => {
    assert.strictEqual(triggerActivationScore('editing migration files in repo', 'editing migration files'), 1);
    assert.strictEqual(triggerActivationScore('editing migrations', 'when editing migrations on postgres'), 1);
  });

  test('returns shared-token ratio for partial overlap', () => {
    // trigger tokens: editing, postgres, migrations -> 2 of 3 shared
    const score = triggerActivationScore('editing migrations for qdrant', 'editing postgres migrations');
    assert.ok(Math.abs(score - 2 / 3) < 1e-9);
  });

  test('normalizes accents, case, and punctuation', () => {
    assert.strictEqual(triggerActivationScore('Editar MIGRACIÓN: 013!', 'editar migracion 013'), 1);
  });

  test('returns 0 for empty or disjoint inputs', () => {
    assert.strictEqual(triggerActivationScore('', 'anything'), 0);
    assert.strictEqual(triggerActivationScore('anything', ''), 0);
    assert.strictEqual(triggerActivationScore('deploy frontend assets', 'rotate database credentials'), 0);
  });

  test('stopwords do not inflate overlap between unrelated before-writing actions', () => {
    const score = triggerActivationScore('before writing tests', 'before writing durable memory');
    assert.ok(score < 0.5);
    assert.ok(score > 0);
  });
});
