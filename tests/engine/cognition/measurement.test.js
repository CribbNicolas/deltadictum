import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReplay, runWritePathProbe, writeProbeProposals, gateFails } from '../../../src/eval/replay.js';
import { CASES } from '../../../src/eval/cases.js';

test('abstention is scored over the scenarios that expect nothing', async () => {
  const report = await runReplay();
  assert.equal(report.abstention.expected, CASES.filter(c => c.expected.length === 0).length);
  assert.equal(report.abstention.expected, 10);
  assert.equal(report.abstention.f1, 1);
  assert.equal(report.rows.filter(r => r.should_abstain && r.abstained).length, 10);
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
  // Derived from the corpus rather than written down, so a scenario can be added
  // to it without the assertion quietly becoming a different claim.
  const proposals = writeProbeProposals();
  const clean = await runWritePathProbe();
  assert.equal(clean.write_attempts, proposals.length);
  assert.equal(clean.duplicates, 0);
  assert.equal(clean.duplicate_rate_per_1000, 0);

  // A topic no near-duplicate scenario revises, so what this measures is an
  // exact repeat rather than a collision routed as a revision.
  const untouched = proposals.findIndex(p => p.topic_key === 'security/logging/credentials');
  const repeated = await runWritePathProbe({ proposals: [...proposals, proposals[untouched]] });
  assert.equal(repeated.write_attempts, proposals.length + 1);
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.duplicate_rate_per_1000, 1 / (proposals.length + 1) * 1000);
});

test('the corpus contains near-duplicates, and none of them survives into the effective set', async () => {
  // The metric judged an empty set before these scenarios existed: a rate of zero
  // over a corpus with nothing to detect proves nothing in either direction.
  const probe = await runWritePathProbe();
  assert.ok(probe.near_duplicates_detected > 0, 'the corpus exercises the collision routing');
  assert.equal(probe.near_duplicate_pairs_surviving, 0);
  // Restatements merge; a different scope and an opposing instruction do not.
  assert.ok(probe.effective_memories < probe.write_attempts);
});

test('evidence coverage is one when references resolve and drops when one is removed', async () => {
  const resolved = await runWritePathProbe();
  assert.equal(resolved.evidence_coverage, 1);

  // Again a topic nothing supersedes: a superseded memory leaves the effective
  // set, taking its missing reference with it.
  const untouched = writeProbeProposals().findIndex(p => p.topic_key === 'security/logging/credentials');
  const missing = await runWritePathProbe({ missingEvidence: [`evidence/${untouched}.md`] });
  assert.equal(missing.effective_memories, resolved.effective_memories);
  assert.equal(missing.evidence_coverage,
    (resolved.effective_memories - 1) / resolved.effective_memories);
  assert.ok(missing.evidence_coverage < resolved.evidence_coverage);
});
