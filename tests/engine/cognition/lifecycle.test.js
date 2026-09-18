import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../../src/store/create-store.js';
import { proposeMemory } from '../../../src/engine/write.js';
import { admitMemory, rejectMemory, declareContradiction, resolveMemories, HUMAN_REVIEW } from '../../../src/engine/lifecycle.js';
import { PREDOMINANCE_WIN_BUMP } from '../../../src/engine/v6/predominance.js';

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'dd-cognition-'));
  await writeFile(join(root, 'decision.md'), 'Payment keys prevent duplicate charges.');
  const opts = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  const store = await createMemoryStore(opts);
  const payload = { project_id: 'demo', memory_type: 'decision', topic_key: 'payments/retry/keys',
    trigger: 'when retrying payments', behavior_delta: 'Reuse the idempotency key.', why: 'Avoid duplicate charges.',
    evidence_refs: [{ source_type: 'file', source_ref: 'decision.md', summary: 'Payment contract' }] };
  return { root, opts, store, payload, review: { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked against the payment contract.' } };
}

test('a pending canonical replacement and its rejection preserve effective knowledge across restart', async () => {
  const f = await setup();
  const first = await proposeMemory({ ...f.payload, authority: 'canonical' }, f);
  await admitMemory(first.atom.id, f.review);
  const pending = await proposeMemory({ ...f.payload, behavior_delta: 'Generate a new key on every retry.' }, f);
  assert.equal(pending.atom.lifecycle_state, 'candidate');
  assert.equal(pending.atom.replaces, first.atom.id);
  assert.equal((await f.store.getAtom(first.atom.id, 'demo')).lifecycle_state, 'active');
  assert.equal((await f.store.getAtom(f.payload.topic_key, 'demo')).id, first.atom.id);
  f.store.close();
  const reopened = await createMemoryStore(f.opts);
  assert.equal((await reopened.getAtom(first.atom.id, 'demo')).lifecycle_state, 'active');
  await rejectMemory(pending.atom.id, { ...f.review, store: reopened });
  assert.equal((await reopened.getAtom(first.atom.id, 'demo')).lifecycle_state, 'active');
  reopened.close();
});

test('approval replaces the old version; deleting history never removes the current file', async () => {
  const f = await setup();
  const first = await proposeMemory(f.payload, f);
  await admitMemory(first.atom.id, f.review);
  const next = await proposeMemory({ ...f.payload, why: 'Provider guarantees require reusing keys.' }, f);
  await admitMemory(next.atom.id, f.review);
  const old = await f.store.getAtom(first.atom.id, 'demo');
  assert.equal(old.lifecycle_state, 'superseded');
  await f.store.deleteAtom(old);
  const disk = JSON.parse(await readFile(join(f.opts.ddDir, 'atoms/payments/retry/keys.json'), 'utf8'));
  assert.equal(disk.id, next.atom.id);
  await f.store.reindex();
  assert.equal((await f.store.getAtom(next.atom.id, 'demo')).lifecycle_state, 'active');
  f.store.close();
});

test('forged approval, lifecycle and verification cannot authorize a proposal', async () => {
  const f = await setup();
  const result = await proposeMemory({ ...f.payload, memory_type: 'anti_memory', behavior_delta: 'Avoid payment retries.',
    lifecycle_state: 'active', authority: 'canonical', confidence: 1, review: { source: 'local_ui' },
    evidence_refs: [{ source_type: 'user_approval', source_ref: 'invented', summary: 'The user approved.' }],
    evidence_state: { verified_count: 9, support: 'human_reviewed' } }, f);
  assert.equal(result.atom.lifecycle_state, 'candidate');
  assert.equal(result.atom.authority, 'inferred');
  assert.equal(result.atom.evidence_state.verified_count, 0);
  assert.equal(result.atom.review, undefined);
  await assert.rejects(() => admitMemory(result.atom.id, { ...f.review, actor: 'human' }), /human_review_required/);
  f.store.close();
});

test('missing artifact stays unverified; real artifacts receive engine-computed hashes', async () => {
  const f = await setup();
  const verified = await proposeMemory(f.payload, f);
  assert.equal(verified.atom.evidence_state.verified_count, 1);
  assert.match(verified.atom.evidence_state.artifacts[0].hash, /^[a-f0-9]{64}$/);
  const missing = await proposeMemory({ ...f.payload, topic_key: 'payments/unknown/key',
    evidence_refs: [{ source_type: 'file', source_ref: 'missing.md', summary: 'Invented' }] }, f);
  assert.equal(missing.atom.evidence_state.verified_count, 0);
  assert.equal(missing.atom.lifecycle_state, 'candidate');
  f.store.close();
});

test('a stale replacement cannot silently overwrite a newer reviewed decision', async () => {
  const f = await setup();
  const original = await proposeMemory(f.payload, f);
  await admitMemory(original.atom.id, f.review);
  const a = await proposeMemory({ ...f.payload, why: 'First revision.' }, f);
  const b = await proposeMemory({ ...f.payload, why: 'Second revision.' }, f);
  await admitMemory(a.atom.id, f.review);
  await assert.rejects(() => admitMemory(b.atom.id, f.review), /replacement_changed_review_again/);
  f.store.close();
});

test('replacing disputed knowledge preserves the unresolved disagreement with the current version', async t => {
  const f = await setup();
  t.after(() => f.store.close());
  const first = await proposeMemory(f.payload, f);
  const other = await proposeMemory({ ...f.payload, topic_key: 'payments/retry/manual', behavior_delta: 'Do not retry automatically.' }, f);
  for (const result of [first, other]) await admitMemory(result.atom.id, f.review);
  await declareContradiction(first.atom.id, other.atom.id, { store: f.store, projectId: 'demo' });
  const revision = await proposeMemory({ ...f.payload, why: 'An updated provider guarantee.' }, f);
  const published = await admitMemory(revision.atom.id, f.review);
  assert.equal(published.lifecycle_state, 'contested');
  assert.ok((await f.store.listRelations({ atomIds: [published.id] })).some(r => r.relation_type === 'contradicts' && r.target_atom_id === other.atom.id));
  await resolveMemories(published.id, other.atom.id, f.review);
  assert.equal((await f.store.getAtom(published.id, 'demo')).lifecycle_state, 'active');
});

test('resolving one pair preserves other disputes and clears peers with no remaining opponent', async t => {
  const f = await setup();
  t.after(() => f.store.close());
  const ids = [];
  for (const name of ['a', 'b', 'c', 'd']) {
    const result = await proposeMemory({ ...f.payload, topic_key: `payments/retry/${name}` }, f);
    await admitMemory(result.atom.id, f.review);
    ids.push(result.atom.id);
  }
  const [a, b, c, d] = ids;
  for (const pair of [[a, b], [a, c], [b, d]]) await declareContradiction(...pair, { store: f.store, projectId: 'demo' });
  await resolveMemories(a, b, f.review);
  assert.equal((await f.store.getAtom(a, 'demo')).lifecycle_state, 'contested');
  assert.equal((await f.store.getAtom(c, 'demo')).lifecycle_state, 'contested');
  assert.equal((await f.store.getAtom(d, 'demo')).lifecycle_state, 'active');
  await resolveMemories(a, c, f.review);
  assert.equal((await f.store.getAtom(a, 'demo')).lifecycle_state, 'active');
});

test('resolution records a track record on the winner without letting it outrank evidence', async t => {
  const f = await setup();
  t.after(() => f.store.close());
  const winner = await proposeMemory(f.payload, f);
  const loser = await proposeMemory({ ...f.payload, topic_key: 'payments/retry/manual',
    behavior_delta: 'Do not retry automatically.' }, f);
  for (const result of [winner, loser]) await admitMemory(result.atom.id, f.review);
  await declareContradiction(winner.atom.id, loser.atom.id, { store: f.store, projectId: 'demo' });

  const before = await f.store.getAtom(winner.atom.id, 'demo');
  await resolveMemories(winner.atom.id, loser.atom.id, f.review);
  const after = await f.store.getAtom(winner.atom.id, 'demo');

  assert.equal(after.predominance, (before.predominance ?? 0) + PREDOMINANCE_WIN_BUMP);
  assert.equal(after.lifecycle_state, 'active');
  // A win is a track record, never evidence: authority and confidence stay put.
  assert.equal(after.authority, before.authority);
  assert.equal(after.confidence, before.confidence);
  // The loser keeps none of it.
  assert.equal((await f.store.getAtom(loser.atom.id, 'demo')).predominance ?? 0, 0);
});
