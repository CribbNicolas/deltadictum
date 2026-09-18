import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { recordOutcome } from '../../src/engine/feedback.js';
import { decideAdmission } from '../../src/engine/v2/admission.js';
import { evaluationStore } from '../../src/eval/replay.js';
import {
  RELIABILITY_LADDER, RELIABILITY_RANK, RELIABILITY_CAP, CAPTURE_ORIGIN_FACTOR,
  reliabilityRank, sourceProvenance, reliabilityCeiling, cappedConfidence,
  VERIFIED_OBSERVATION_PROVENANCES,
} from '../../src/engine/reliability.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dd-reliability-'));
  await writeFile(join(root, 'decision.md'), 'Payment keys prevent duplicate charges.');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  const base = { project_id: 'demo', memory_type: 'decision', topic_key: 'payments/retry/keys',
    trigger: 'when retrying payments', behavior_delta: 'Reuse the idempotency key.', why: 'Avoid duplicate charges.' };
  const verified = { ...base, evidence_refs: [{ source_type: 'file', source_ref: 'decision.md', summary: 'Payment contract' }] };
  const claimed = { ...base, evidence_refs: [{ source_type: 'user_statement', source_ref: 'the user said so', summary: 'Reported instruction' }] };
  return { root, store, verified, claimed,
    review: { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked against the payment contract.' } };
}

describe('reliability ladder', () => {
  test('caps and ranks agree on every ordering', () => {
    // The same property tests/engine/authority.test.js asserts for authority: a
    // second projection that disagrees with the first would make the ladder
    // mean two different things depending on who read it.
    const names = RELIABILITY_LADDER.map(level => level.name);
    for (const a of names) {
      for (const b of names) {
        assert.equal(Math.sign(RELIABILITY_RANK[a] - RELIABILITY_RANK[b]),
          Math.sign(RELIABILITY_CAP[a] - RELIABILITY_CAP[b]),
          `${a} and ${b} are ordered differently by rank and by cap`);
      }
    }
  });

  test('covers the provenances evidence verification assigns, plus the user correction stage 5 adds', () => {
    assert.deepEqual([...RELIABILITY_LADDER.map(l => l.name)].sort(),
      ['agent_claim', 'filesystem', 'host', 'user_correction']);
    assert.equal(RELIABILITY_RANK.agent_claim, Math.min(...Object.values(RELIABILITY_RANK)));
    assert.equal(RELIABILITY_RANK.user_correction, Math.max(...Object.values(RELIABILITY_RANK)));
  });

  test('the observation provenances that verify are derived from the ladder, not listed twice', () => {
    assert.deepEqual([...VERIFIED_OBSERVATION_PROVENANCES],
      RELIABILITY_LADDER.filter(l => l.observed).map(l => l.name));
    assert.ok(VERIFIED_OBSERVATION_PROVENANCES.includes('host'));
    assert.ok(!VERIFIED_OBSERVATION_PROVENANCES.includes('filesystem'));
  });

  test('an unrecognised provenance is treated as least reliable, not as an average', () => {
    assert.equal(reliabilityRank('invented'), RELIABILITY_RANK.agent_claim);
    assert.equal(reliabilityRank(undefined), RELIABILITY_RANK.agent_claim);
    assert.equal(sourceProvenance({ evidence_state: { artifacts: [{ status: 'verified', provenance: 'invented' }] } }),
      'agent_claim');
    // And an unknown capture origin takes the lowest factor rather than the best.
    assert.equal(reliabilityCeiling({ capture_origin: 'invented' }).cap,
      reliabilityCeiling({ capture_origin: 'model_initiated' }).cap);
  });

  test('only verified artifacts raise the source; an unverified claim is an agent claim whatever it claims', () => {
    const unverified = { capture_origin: 'user_explicit',
      evidence_state: { artifacts: [{ status: 'unverified', provenance: 'filesystem' }] } };
    assert.equal(sourceProvenance(unverified), 'agent_claim');
    assert.equal(reliabilityCeiling(unverified).cap, RELIABILITY_CAP.agent_claim);
  });

  test('the cap composes with evidence instead of replacing it', () => {
    const one = { capture_origin: 'user_explicit', evidence_state: { artifacts: [
      { status: 'verified', provenance: 'filesystem' }] } };
    const three = { capture_origin: 'user_explicit', evidence_state: { artifacts: [
      { status: 'verified', provenance: 'filesystem' }, { status: 'verified', provenance: 'filesystem' },
      { status: 'verified', provenance: 'filesystem' }] } };
    // Volume of evidence does not lift a memory past its source's ceiling.
    assert.equal(reliabilityCeiling(three).cap, reliabilityCeiling(one).cap);
    assert.equal(reliabilityCeiling(one).cap, RELIABILITY_CAP.filesystem);
    // A host observation is verified, and still ranks under a repository artifact.
    const host = { capture_origin: 'user_explicit', evidence_state: { artifacts: [
      { status: 'verified', provenance: 'host' }] } };
    assert.ok(reliabilityCeiling(host).cap < reliabilityCeiling(one).cap);
    assert.ok(reliabilityCeiling(host).cap > RELIABILITY_CAP.agent_claim);
  });

  test('capture origin can only lower a ceiling, and never inverts the provenance order', () => {
    assert.equal(CAPTURE_ORIGIN_FACTOR.user_explicit, 1);
    assert.ok(CAPTURE_ORIGIN_FACTOR.model_initiated < 1);
    const withOrigin = (capture_origin, provenance) => reliabilityCeiling({ capture_origin,
      evidence_state: { artifacts: [{ status: 'verified', provenance }] } }).cap;
    for (const level of RELIABILITY_LADDER) {
      assert.ok(withOrigin('model_initiated', level.name) <= withOrigin('user_explicit', level.name));
    }
    // An agent-reported "the user asked me to save this" must not outrank a
    // verified repository artifact captured autonomously.
    assert.ok(withOrigin('model_initiated', 'filesystem') > withOrigin('user_explicit', 'agent_claim'));
    assert.ok(withOrigin('model_initiated', 'host') > withOrigin('user_explicit', 'agent_claim'));
  });

  test('human review sits above the ladder: canonical is not clamped', () => {
    const claim = { capture_origin: 'model_initiated',
      evidence_state: { artifacts: [{ status: 'unverified', provenance: 'agent_claim' }] } };
    assert.equal(cappedConfidence(claim, { authority: 'validated' }), reliabilityCeiling(claim).cap);
    assert.equal(cappedConfidence(claim, { authority: 'canonical' }), 1);
  });

  test('the gate reads capture origin and evidence provenance without changing a decision', () => {
    const payload = { project_id: 'demo', memory_type: 'lesson', scope: 'project', title: 'T',
      trigger: 'when x', behavior_delta: 'do y', what: 'do y', why: 'because', topic_key: 'a/b',
      evidence_refs: [{ source_type: 'file', source_ref: 'decision.md', summary: 's' }],
      retrieval_forms: { micro: 'do y', short: 'do y because' },
      capture_origin: 'model_initiated',
      evidence_state: { artifacts: [{ status: 'verified', provenance: 'filesystem' }] } };
    const decision = decideAdmission(payload);
    assert.equal(decision.decision, 'write');
    assert.deepEqual(decision.reasons, ['durable_contract_satisfied']);
    assert.equal(decision.reliability.provenance, 'filesystem');
    assert.equal(decision.reliability.capture_origin, 'model_initiated');
    assert.equal(decision.reliability.cap, reliabilityCeiling(payload).cap);
    // Reading provenance must not become a way to reject a proposal: an
    // unverified claim is still a candidate awaiting review.
    const claimed = decideAdmission({ ...payload, evidence_state: undefined });
    assert.equal(claimed.decision, 'write');
    assert.equal(claimed.reliability.provenance, 'agent_claim');
  });
});

describe('reliability at admission', () => {
  test('a verified repository artifact reaches the filesystem cap', async () => {
    const f = await setup();
    const proposed = await proposeMemory(f.verified, { store: f.store });
    const admitted = await admitMemory(proposed.atom.id, f.review);
    assert.equal(admitted.confidence, RELIABILITY_CAP.filesystem);
    assert.equal(admitted.authority, 'validated');
    f.store.close();
  });

  test('the cap holds under volume: no quantity of agent claims reaches a verified artifact', async () => {
    const f = await setup();
    const verified = await proposeMemory(f.verified, { store: f.store });
    const admittedVerified = await admitMemory(verified.atom.id, f.review);

    // The red team: many low-reliability memories, each re-proposed, each
    // reported successful several times.
    const claims = [];
    for (let i = 0; i < 12; i++) {
      // Distinct scopes, so these are twelve memories rather than one restated
      // twelve times: a near-duplicate is now routed as a revision, and the cap
      // this test is about is a property of separate memories under volume.
      const proposed = await proposeMemory({ ...f.claimed, topic_key: `claims/volume/${i}`,
        capture_origin: 'user_explicit', applies_to: { components: [`claims-${i}`] },
        behavior_delta: `Reuse the idempotency key on attempt ${i}.` }, { store: f.store });
      assert.equal(proposed.decision, 'write');
      const admitted = await admitMemory(proposed.atom.id, f.review);
      claims.push(admitted);
      // Re-proposing identical knowledge is ignored, so repetition cannot
      // accumulate standing even as a second candidate.
      const repeat = await proposeMemory({ ...f.claimed, topic_key: `claims/volume/${i}`,
        capture_origin: 'user_explicit', applies_to: { components: [`claims-${i}`] },
        behavior_delta: `Reuse the idempotency key on attempt ${i}.` }, { store: f.store });
      assert.equal(repeat.decision, 'ignore');
      assert.equal(repeat.atom.confidence, RELIABILITY_CAP.agent_claim);
      for (let n = 0; n < 5; n++) {
        await recordOutcome({ id: admitted.id, outcome: 'helped', task_id: `task-${i}-${n}`,
          summary: 'The advice worked.' }, { store: f.store, projectId: 'demo' });
      }
    }

    for (const claim of claims) {
      const current = await f.store.getAtom(claim.id, 'demo');
      assert.equal(current.confidence, RELIABILITY_CAP.agent_claim);
      assert.ok(current.confidence < admittedVerified.confidence,
        'an agent claim reached the standing of a verified artifact');
    }
    f.store.close();
  });

  test('a reported outcome still raises nothing', async () => {
    const f = await setup();
    const proposed = await proposeMemory(f.verified, { store: f.store });
    const admitted = await admitMemory(proposed.atom.id, f.review);
    for (const outcome of ['helped', 'helped', 'helped']) {
      await recordOutcome({ id: admitted.id, outcome, task_id: `t-${outcome}-${Math.random()}`,
        summary: 'It worked.' }, { store: f.store, projectId: 'demo' });
    }
    const after = await f.store.getAtom(admitted.id, 'demo');
    assert.equal(after.confidence, admitted.confidence);
    assert.equal(after.authority, admitted.authority);
    assert.equal(after.lifecycle_state, admitted.lifecycle_state);
    f.store.close();
  });

  test('a reviewer granting canonical is not clamped by the source ladder', async () => {
    const f = await setup();
    const proposed = await proposeMemory(f.claimed, { store: f.store });
    const admitted = await admitMemory(proposed.atom.id, { ...f.review, authority: 'canonical' });
    assert.equal(admitted.authority, 'canonical');
    assert.equal(admitted.confidence, 1);
    assert.ok(admitted.confidence > RELIABILITY_CAP.agent_claim);
    f.store.close();
  });

  test('a host observation admits between an agent claim and a repository artifact', async () => {
    const f = await setup();
    const observation = await f.store.putObservation({ project_id: 'demo', source_type: 'validation',
      raw_preview: 'Validation passed (exit 0).', source_ref: 'Bash', metadata: { provenance: 'host' } });
    const proposed = await proposeMemory({ ...f.verified, topic_key: 'payments/retry/host',
      evidence_refs: [{ source_type: 'tool_output', source_ref: observation.id, summary: 'Suite passed' }] },
      { store: f.store });
    const admitted = await admitMemory(proposed.atom.id, f.review);
    assert.equal(admitted.evidence_state.artifacts[0].provenance, 'host');
    assert.equal(admitted.confidence, RELIABILITY_CAP.host);
    assert.ok(admitted.confidence > RELIABILITY_CAP.agent_claim);
    assert.ok(admitted.confidence < RELIABILITY_CAP.filesystem);
    f.store.close();
  });

  test('a proposal derives its confidence from the ladder instead of a flat constant', async () => {
    const f = await setup();
    const proposed = await proposeMemory({ ...f.verified, capture_origin: 'model_initiated' }, { store: f.store });
    // Nothing is verified when normalizeProposal runs, so every proposal sits at
    // the unverified floor by construction. What matters is that the number is
    // the ladder's, and can never exceed what the source earns.
    assert.equal(proposed.atom.confidence, reliabilityCeiling({ capture_origin: 'model_initiated' }).cap);
    assert.ok(proposed.atom.confidence <= RELIABILITY_CAP.agent_claim);
    f.store.close();
  });
});

describe('the evaluation replay is unaffected', () => {
  test('retrieval fixtures are seeded through putAtom, so the ladder cannot move them', async () => {
    const store = await evaluationStore();
    const atoms = await store.listAtoms({ projectId: 'eval' });
    assert.ok(atoms.length > 0);
    for (const atom of atoms) {
      // Seeded, not admitted: no verification ran and confidence is the fixture's
      // own. If this ever changes, the recorded baseline stops being comparable.
      assert.equal(atom.confidence, 0.85);
      assert.equal(atom.evidence_state, undefined);
    }
    store.close();
  });
});
