import { describe, test } from 'node:test';
import assert from 'node:assert';
import { decideV3Admission } from '../../../src/engine/v3/admission.js';

const NOW = '2026-06-05T00:00:00.000Z';

function validPayload(overrides = {}) {
  return {
    project_id: 'orquesta',
    memory_type: 'lesson',
    scope: 'project',
    title: 'Require V3 evidence capsules',
    trigger: 'before writing durable V3 memory',
    behavior_delta: 'validate behavioral fields and supporting evidence capsules first',
    what: 'V3 durable memory must be backed by usable evidence capsules.',
    why: 'Prevents active memories without scoped, temporally valid support.',
    topic_key: 'memory/v3/evidence-gate',
    retrieval_forms: {
      micro: 'Require V3 evidence.',
      short: 'Validate V3 support capsules before active memory.',
      full: 'Durable V3 memory writes require complete behavioral fields and usable supporting evidence capsules.',
    },
    evidence: [{ role: 'supports', evidence_id: 'evidence-1' }],
    ...overrides,
  };
}

function validCapsule(overrides = {}) {
  return {
    id: 'evidence-1',
    project_id: 'orquesta',
    source_type: 'test_log',
    source_ref: 'node --test tests/unit/memory-api/v3/admission.test.js',
    source_artifact_id: null,
    observed_at: NOW,
    valid_from: NOW,
    valid_until: null,
    summary: 'V3 admission evidence tests passed.',
    hash: null,
    hash_status: 'not_checked',
    sensitivity: 'project',
    metadata: {},
    ...overrides,
  };
}

describe('V3 admission gate', () => {
  test('writes when V2 behavioral fields and supporting evidence capsules are valid', () => {
    const decision = decideV3Admission(validPayload(), [validCapsule()], { now: NOW });

    assert.deepStrictEqual(decision, {
      decision: 'write',
      reasons: ['durable_contract_satisfied'],
      score: 1,
    });
  });

  test('observes incomplete memory candidates without creating active memory', () => {
    const decision = decideV3Admission(validPayload({ trigger: '', behavior_delta: '' }), [validCapsule()], { now: NOW });

    assert.strictEqual(decision.decision, 'observe');
    assert.strictEqual(decision.score, 0.25);
    assert.ok(decision.reasons.includes('missing_trigger'));
    assert.ok(decision.reasons.includes('missing_behavior_delta'));
  });

  test('requires at least one valid supporting evidence capsule', () => {
    const noLinks = decideV3Admission(validPayload({ evidence: [] }), [validCapsule()], { now: NOW });
    const unresolvedLink = decideV3Admission(validPayload(), [], { now: NOW });

    assert.strictEqual(noLinks.decision, 'observe');
    assert.ok(noLinks.reasons.includes('evidence_required'));
    assert.strictEqual(unresolvedLink.decision, 'observe');
    assert.ok(unresolvedLink.reasons.includes('evidence_required'));
  });

  test('requires every supporting evidence link to resolve', () => {
    const decision = decideV3Admission(validPayload({
      evidence: [
        { role: 'supports', evidence_id: 'evidence-1' },
        { role: 'supports', evidence_id: 'missing-evidence' },
      ],
    }), [validCapsule()], { now: NOW });

    assert.strictEqual(decision.decision, 'observe');
    assert.strictEqual(decision.score, 0.25);
    assert.ok(decision.reasons.includes('evidence_required'));
  });

  test('does not match malformed support links to malformed capsules', () => {
    const decision = decideV3Admission(validPayload({
      evidence: [{ role: 'supports' }],
    }), [validCapsule({ id: undefined })], { now: NOW });

    assert.strictEqual(decision.decision, 'observe');
    assert.strictEqual(decision.score, 0.25);
    assert.ok(decision.reasons.includes('evidence_required'));
  });

  test('hard-blocks cross-project evidence with statusCode 403', () => {
    const decision = decideV3Admission(validPayload(), [validCapsule({ project_id: 'other-project' })], { now: NOW });

    assert.strictEqual(decision.decision, 'block');
    assert.strictEqual(decision.statusCode, 403);
    assert.strictEqual(decision.score, 0);
    assert.ok(decision.reasons.includes('evidence_scope_violation'));
  });

  test('preserves V2 missing project block without evidence scope violation', () => {
    const decision = decideV3Admission(validPayload({ project_id: '' }), [validCapsule()], { now: NOW });

    assert.strictEqual(decision.decision, 'block');
    assert.strictEqual(decision.statusCode, undefined);
    assert.strictEqual(decision.score, 0);
    assert.ok(decision.reasons.includes('missing_project_id'));
    assert.strictEqual(decision.reasons.includes('evidence_scope_violation'), false);
  });

  test('observes supporting evidence with missing project_id as invalid evidence', () => {
    const decision = decideV3Admission(validPayload(), [validCapsule({ project_id: '' })], { now: NOW });

    assert.strictEqual(decision.decision, 'observe');
    assert.strictEqual(decision.statusCode, undefined);
    assert.strictEqual(decision.score, 0.25);
    assert.ok(decision.reasons.includes('missing_project_id'));
    assert.strictEqual(decision.reasons.includes('evidence_scope_violation'), false);
  });

  test('observes unusable supporting evidence instead of writing active memory', () => {
    const cases = [
      ['expired_evidence', validCapsule({ valid_from: '2025-01-01T00:00:00.000Z', valid_until: '2026-01-01T00:00:00.000Z' })],
      ['evidence_hash_mismatch', validCapsule({ hash_status: 'mismatched' })],
      ['future_observed_evidence', validCapsule({ observed_at: '2026-06-06T00:00:00.000Z' })],
      ['not_yet_valid_evidence', validCapsule({ valid_from: '2026-07-01T00:00:00.000Z' })],
      ['invalid_hash', validCapsule({ hash: 'not-a-sha256' })],
    ];

    for (const [reason, capsule] of cases) {
      const decision = decideV3Admission(validPayload(), [capsule], { now: NOW });

      assert.strictEqual(decision.decision, 'observe', reason);
      assert.strictEqual(decision.score, 0.25, reason);
      assert.ok(decision.reasons.includes(reason), reason);
    }
  });
});
