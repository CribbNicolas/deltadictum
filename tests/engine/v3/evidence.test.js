import { describe, test } from 'node:test';
import assert from 'node:assert';
import { validateEvidenceCapsule, redactEvidenceCapsule, isEvidenceUsableForActiveMemory } from '../../../src/engine/v3/evidence.js';

function validCapsule(overrides = {}) {
  return {
    id: 'evidence-1',
    project_id: 'orquesta',
    source_type: 'test_log',
    source_ref: 'npm --prefix services/memory-api run test:v3',
    source_artifact_id: null,
    observed_at: '2026-06-05T00:00:00.000Z',
    valid_from: '2026-06-05T00:00:00.000Z',
    valid_until: null,
    summary: 'V3 evidence tests passed.',
    hash: null,
    hash_status: 'not_checked',
    sensitivity: 'project',
    metadata: {},
    ...overrides,
  };
}

describe('V3 evidence capsules', () => {
  test('accepts a scoped valid evidence capsule', () => {
    assert.deepStrictEqual(validateEvidenceCapsule(validCapsule()), { valid: true, reasons: [] });
  });

  test('rejects invalid source, time, hash, and sensitivity fields', () => {
    const result = validateEvidenceCapsule(validCapsule({
      source_type: 'chat_history',
      source_ref: '',
      observed_at: 'not-a-date',
      valid_from: '',
      valid_until: '2026-01-01T00:00:00.000Z',
      summary: '',
      hash_status: 'bad',
      sensitivity: 'global',
    }));
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(result.reasons.sort(), [
      'invalid_hash_status',
      'invalid_observed_at',
      'invalid_sensitivity',
      'invalid_source_type',
      'invalid_valid_from',
      'invalid_valid_until',
      'missing_source_ref',
      'missing_summary',
    ].sort());
  });

  test('rejects non-monotonic valid intervals', () => {
    const result = validateEvidenceCapsule(validCapsule({
      valid_from: '2026-06-05T00:00:00.000Z',
      valid_until: '2026-01-01T00:00:00.000Z',
    }));
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(result.reasons, ['invalid_valid_until']);
  });

  test('rejects invalid evidence hashes', () => {
    const result = validateEvidenceCapsule(validCapsule({ hash: 'not-a-sha256' }));
    assert.strictEqual(result.valid, false);
    assert.deepStrictEqual(result.reasons, ['invalid_hash']);
  });

  test('accepts valid SHA-256 evidence hashes', () => {
    assert.deepStrictEqual(validateEvidenceCapsule(validCapsule({
      hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789ABCDEF',
    })), { valid: true, reasons: [] });
  });

  test('blocks active support for expired or hash-mismatched evidence', () => {
    assert.deepStrictEqual(isEvidenceUsableForActiveMemory(validCapsule({ valid_from: '2025-01-01T00:00:00.000Z', valid_until: '2026-01-01T00:00:00.000Z' }), '2026-06-05T00:00:00.000Z'), { usable: false, reason: 'expired_evidence' });
    assert.deepStrictEqual(isEvidenceUsableForActiveMemory(validCapsule({ hash_status: 'mismatched' }), '2026-06-05T00:00:00.000Z'), { usable: false, reason: 'evidence_hash_mismatch' });
  });

  test('blocks active support for future-observed evidence', () => {
    assert.deepStrictEqual(isEvidenceUsableForActiveMemory(validCapsule({
      observed_at: '2026-06-06T00:00:00.000Z',
    }), '2026-06-05T00:00:00.000Z'), { usable: false, reason: 'future_observed_evidence' });
  });

  test('blocks active support for future-dated evidence', () => {
    assert.deepStrictEqual(isEvidenceUsableForActiveMemory(validCapsule({
      valid_from: '2026-07-01T00:00:00.000Z',
      valid_until: '2026-08-01T00:00:00.000Z',
    }), '2026-06-05T00:00:00.000Z'), { usable: false, reason: 'not_yet_valid_evidence' });
  });

  test('does not mark non-monotonic intervals usable for active memory', () => {
    assert.deepStrictEqual(isEvidenceUsableForActiveMemory(validCapsule({
      valid_from: '2026-06-05T00:00:00.000Z',
      valid_until: '2026-01-01T00:00:00.000Z',
    }), '2026-06-05T00:00:00.000Z'), { usable: false, reason: 'invalid_valid_until' });
  });

  test('redacts private and secret evidence bodies for unauthorized readers', () => {
    const redacted = redactEvidenceCapsule(validCapsule({ sensitivity: 'secret', summary: 'Sensitive proof.', metadata: { raw: 'hidden' } }), { canReadPrivate: false, canReadSecret: false });
    assert.strictEqual(redacted.summary, '[redacted]');
    assert.deepStrictEqual(redacted.metadata, {});
    assert.strictEqual(redacted.redacted, true);
  });
});
