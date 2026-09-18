import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReplay, runWritePathProbe, writeProbeProposals, gateFails } from '../../../src/eval/replay.js';
import { CASES } from '../../../src/eval/cases.js';

test('abstention is scored over the scenarios that expect nothing', async () => {
  const report = await runReplay();
  assert.equal(report.abstention.expected, CASES.filter(c => c.expected.length === 0).length);
  assert.equal(report.abstention.expected, 9);
  assert.equal(report.abstention.f1, 1);
  assert.equal(report.rows.filter(r => r.should_abstain && r.abstained).length, 9);
});

test('a retrieval that injects on every scenario drives abstention recall to zero', async () => {
  // A metric that cannot go down measures nothing.
  const everything = async () => ({ memories: [{ topic_key: 'payments/retry/idempotency', lifecycle_state: 'active',
    retrieval_forms: { micro: 'noise' } }], decision: 'inject', budget_used: 1 });
  const report = await runReplay({ retrieve: everything });
  assert.equal(report.abstention.recall, 0);
  assert.equal(report.abstention.f1, 0);
  assert.ok(gateFails(report));
});

test('the existing gate still fires on retrieval quality alone', () => {
  const healthy = { f1: 1, exact: CASES.length, abstention: { f1: 1 } };
  assert.equal(gateFails(healthy), false);
  assert.equal(gateFails({ ...healthy, f1: 0.89 }), true);
  assert.equal(gateFails({ ...healthy, exact: Math.floor(CASES.length * 0.9) - 1 }), true);
  assert.equal(gateFails({ ...healthy, abstention: { f1: 0.89 } }), true);
});

test('duplicate rate is zero without duplicates and non-zero when one proposal repeats', async () => {
  const clean = await runWritePathProbe();
  assert.equal(clean.write_attempts, 7);
  assert.equal(clean.duplicates, 0);
  assert.equal(clean.duplicate_rate_per_1000, 0);

  const proposals = writeProbeProposals();
  const repeated = await runWritePathProbe({ proposals: [...proposals, proposals[0]] });
  assert.equal(repeated.write_attempts, 8);
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.duplicate_rate_per_1000, 125);
});

test('evidence coverage is one when references resolve and drops when one is removed', async () => {
  const resolved = await runWritePathProbe();
  assert.equal(resolved.effective_memories, 7);
  assert.equal(resolved.evidence_coverage, 1);

  const missing = await runWritePathProbe({ missingEvidence: ['evidence/0.md'] });
  assert.equal(missing.effective_memories, 7);
  assert.equal(missing.evidence_coverage, 6 / 7);
  assert.ok(missing.evidence_coverage < resolved.evidence_coverage);
});
