import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../../src/store/create-store.js';
import { proposeMemory } from '../../../src/engine/write.js';
import { retrieveMemories } from '../../../src/engine/retrieve.js';
import { admitMemory, HUMAN_REVIEW, declareContradiction } from '../../../src/engine/lifecycle.js';
import { estimateTokens } from '../../../src/engine/budget.js';
import { recordOutcome } from '../../../src/engine/feedback.js';
import { microPack } from '../../../src/hooks/session-start.js';

async function fixture(t, fields = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dd-recall-'));
  await writeFile(join(root, 'contract.md'), 'Reuse payment keys.');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  const proposal = { project_id: 'demo', topic_key: 'payments/retry/keys', trigger: 'when retrying payment requests',
    behavior_delta: 'Reuse the idempotency key.', why: 'Avoid duplicate charges.',
    evidence_refs: [{ source_type: 'file', source_ref: 'contract.md', summary: 'Payment contract' }], ...fields };
  const result = await proposeMemory(proposal, { store });
  const atom = await admitMemory(result.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked the payment contract.' });
  const retrieve = fields => retrieveMemories({ project_id: 'demo', action: 'when retrying payment requests', ...fields }, { store });
  return { root, store, atom, retrieve, proposal };
}

test('paraphrases and Spanish concepts activate the same applicable lesson', async t => {
  const f = await fixture(t, { trigger_variants: ['after a timeout resubmit the charge'] });
  for (const action of ['retry failed payments', 'reintentar solicitudes de pago', 'after a timeout resubmit the charge']) {
    assert.equal((await f.retrieve({ action })).memories[0]?.id, f.atom.id, action);
  }
});

test('mismatched scope/facts suppress advice and missing facts preserve conditions', async t => {
  const f = await fixture(t, { applies_to: { files: ['src/payments/**'] }, assumptions: [{ key: 'provider.idempotency', equals: true, description: 'provider supports idempotency' }] });
  assert.equal((await f.retrieve({ files: ['src/ui/button.js'], facts: { 'provider.idempotency': true } })).memories.length, 0);
  assert.equal((await f.retrieve({ files: ['src/payments/charge.js'], facts: { 'provider.idempotency': false } })).memories.length, 0);
  const unknown = await f.retrieve({ files: ['src/payments/charge.js'] });
  assert.match(unknown.memories[0].content, /provider supports idempotency/);
  assert.match(unknown.memories[0].content, /verify assumption/);
});

test('changed evidence produces a review notice, and a session cannot hide the change', async t => {
  const f = await fixture(t);
  assert.equal((await f.retrieve({ session_id: 's' })).memories.length, 1);
  assert.equal((await f.retrieve({ session_id: 's' })).memories.length, 0);
  await writeFile(join(f.root, 'contract.md'), 'The provider contract has changed.');
  const stale = await f.retrieve({ session_id: 's' });
  assert.equal(stale.memories[0].lifecycle_state, 'review_required');
  assert.doesNotMatch(stale.memories[0].content, /Reuse the idempotency key/);
  const refreshed = await proposeMemory(f.proposal, { store: f.store });
  assert.equal(refreshed.atom.lifecycle_state, 'candidate');
  assert.notEqual(refreshed.atom.id, f.atom.id);
  await admitMemory(refreshed.atom.id, { store: f.store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Rechecked changed provider evidence.' });
  assert.equal((await f.retrieve({})).memories[0].lifecycle_state, undefined);
});

test('fact changes and explicit validity windows prevent stale advice', async t => {
  const f = await fixture(t, { revisit_when: [{ kind: 'fact_changed', key: 'writers', equals: 1, description: 'writer topology changed' }] });
  const changed = await f.retrieve({ facts: { writers: 2 } });
  assert.equal(changed.memories[0].lifecycle_state, 'review_required');
  await f.store.putAtom({ ...f.atom, valid_from: '2099-01-01T00:00:00Z' });
  assert.equal((await f.retrieve({})).memories.length, 0);
});

test('session deduplication emits changed conditions even when the memory itself is unchanged', async t => {
  const f = await fixture(t, { assumptions: [{ key: 'idempotency', equals: true, description: 'provider supports idempotency' }] });
  const known = await f.retrieve({ session_id: 'conditions', facts: { idempotency: true } });
  assert.equal(known.memories.length, 1);
  const unknown = await f.retrieve({ session_id: 'conditions' });
  assert.equal(unknown.memories.length, 1);
  assert.match(unknown.memories[0].content, /verify assumption/);
  assert.equal((await f.retrieve({ session_id: 'conditions' })).memories.length, 0);
});

test('long preferred form falls back at both large and small budgets; full payload is charged', async t => {
  const f = await fixture(t, { why: 'A detailed rationale about network timing and duplicate charges. '.repeat(8) });
  for (const budget of [180, 600]) {
    const recalled = await f.retrieve({ budget_tokens: budget });
    assert.equal(recalled.memories[0]?.form_type, 'micro');
    assert.ok(estimateTokens(recalled) <= budget);
    assert.ok(recalled.budget.used >= estimateTokens(recalled));
  }
});

test('disputes survive the hook pack and point at the conflicting memory', async t => {
  const f = await fixture(t);
  const proposed = await proposeMemory({ ...f.proposal, topic_key: 'payments/retry/other', behavior_delta: 'Do not retry payments.' }, { store: f.store });
  await admitMemory(proposed.atom.id, { store: f.store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Alternative contract.' });
  await declareContradiction(f.atom.id, proposed.atom.id, { store: f.store, projectId: 'demo' });
  const recalled = await f.retrieve({});
  assert.ok(recalled.memories[0].contradicts.length);
  assert.match(microPack(recalled.memories), /DISPUTED/);
});

test('success reports never raise confidence; verified counterevidence produces review', async t => {
  const f = await fixture(t);
  await recordOutcome({ id: f.atom.id, task_id: 'one', outcome: 'helped', summary: 'It worked.' }, { store: f.store, projectId: 'demo' });
  assert.equal((await f.store.getAtom(f.atom.id, 'demo')).confidence, f.atom.confidence);
  await writeFile(join(f.root, 'failure.md'), 'Duplicate charge with the reused key.');
  const report = await recordOutcome({ id: f.atom.id, task_id: 'two', outcome: 'refuted', summary: 'Observed duplicate charge.',
    evidence_refs: [{ source_type: 'file', source_ref: 'failure.md', summary: 'Reproduction' }] }, { store: f.store, projectId: 'demo' });
  assert.equal((await f.retrieve({})).memories[0].lifecycle_state, 'review_required');
  await f.store.reviewFeedback(report.id, 'demo', false);
  assert.equal((await f.retrieve({})).memories[0].lifecycle_state, undefined);
});

test('an injected pack never carries both sides of a contradiction', async t => {
  // Distinct triggers, so the pair is separated by the contradiction itself and
  // not by the near-duplicate guard.
  const f = await fixture(t);
  const opposing = await proposeMemory({ ...f.proposal, topic_key: 'payments/retry/opposing',
    trigger: 'when retrying payment charges', behavior_delta: 'Do not retry payments.' }, { store: f.store });
  await admitMemory(opposing.atom.id, { store: f.store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Opposing contract.' });
  const both = await f.retrieve({ budget_tokens: 4000 });
  assert.equal(both.memories.length, 2, 'both memories are retrievable while they do not conflict');

  await declareContradiction(f.atom.id, opposing.atom.id, { store: f.store, projectId: 'demo' });
  const recalled = await f.retrieve({ budget_tokens: 4000 });
  assert.equal(recalled.memories.length, 1);
  assert.ok(recalled.memories[0].contradicts.includes(
    recalled.memories[0].id === f.atom.id ? opposing.atom.id : f.atom.id));
});

test('near duplicate advice does not spend the budget twice', async t => {
  const f = await fixture(t);
  const echo = await proposeMemory({ ...f.proposal, topic_key: 'payments/retry/echo',
    behavior_delta: 'Reuse the original idempotency key.' }, { store: f.store });
  await admitMemory(echo.atom.id, { store: f.store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Restated the same rule.' });
  const recalled = await f.retrieve({ budget_tokens: 4000 });
  assert.equal(recalled.memories.length, 1, 'an identical trigger adds tokens without adding advice');
});
