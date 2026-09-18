import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { cappedConfidence } from '../../src/engine/reliability.js';

const PROJECT = 'collide';

function proposal(overrides = {}) {
  return {
    project_id: PROJECT,
    memory_type: 'lesson',
    scope: 'project',
    title: 'Reuse the idempotency key',
    trigger: 'when retrying payment requests',
    behavior_delta: 'Reuse the original idempotency key.',
    what: 'Retries must not double charge.',
    why: 'The same logical payment must not be charged twice.',
    topic_key: 'payments/retry/idempotency',
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/write.js', summary: 'Write path' }],
    retrieval_forms: { micro: 'Reuse the key.', short: 'Reuse the original idempotency key on retry.' },
    ...overrides,
  };
}

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'dd-collide-'));
  return createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
}

// Review is what makes a memory effective; these tests seed what review writes.
async function activate(db, atom) {
  return db.putAtom({ ...atom, lifecycle_state: 'active', authority: 'validated',
    confidence: cappedConfidence(atom, { authority: 'validated' }) });
}

async function seedEffective(db, overrides = {}) {
  const written = await proposeMemory(proposal(overrides), { store: db });
  assert.equal(written.decision, 'write');
  return activate(db, written.atom);
}

describe('trigger collisions', () => {
  test('a paraphrase of an effective memory is proposed as its revision, not a sibling', async () => {
    const db = await store();
    try {
      const original = await seedEffective(db);
      const paraphrase = await proposeMemory(proposal({
        topic_key: 'payments/retries/keys',
        title: 'Keep the idempotency key when retrying',
        trigger: 'when retrying a payment request',
        behavior_delta: 'Send the original idempotency key again.',
        why: 'One logical payment must be charged once.',
      }), { store: db });

      assert.equal(paraphrase.decision, 'update');
      assert.ok(paraphrase.reasons.includes('trigger_collision_same_scope'));
      assert.equal(paraphrase.atom.replaces, original.id);
      // Nothing is effective yet: the original still stands, unmodified.
      assert.equal((await db.getAtom(original.id, PROJECT)).lifecycle_state, 'active');
      assert.equal(paraphrase.atom.lifecycle_state, 'candidate');

      // Only review resolves the pair, and it leaves one effective memory, not two.
      await admitMemory(paraphrase.atom.id, { store: db, projectId: PROJECT, actor: HUMAN_REVIEW,
        rationale: 'Local review: the paraphrase restates the same lesson.' });
      assert.equal((await db.getAtom(original.id, PROJECT)).lifecycle_state, 'superseded');
      const effective = await db.listAtoms({ projectId: PROJECT, lifecycleStates: ['active', 'contested'] });
      assert.equal(effective.length, 1);
    } finally { db.close(); }
  });

  test('a matching trigger with a different scope is separate knowledge', async () => {
    const db = await store();
    try {
      const original = await seedEffective(db, { applies_to: { components: ['payments'] } });
      const other = await proposeMemory(proposal({
        topic_key: 'shipping/retry/idempotency',
        applies_to: { components: ['shipping'] },
        behavior_delta: 'Reuse the original dispatch key.',
      }), { store: db });

      // The activation gate treats these as different knowledge; so does admission.
      assert.equal(other.decision, 'write');
      assert.equal(other.atom.replaces, undefined);
      assert.equal(other.atom.suspected_pair, undefined);
      await admitMemory(other.atom.id, { store: db, projectId: PROJECT, actor: HUMAN_REVIEW,
        rationale: 'Local review: shipping is not payments.' });
      assert.equal((await db.getAtom(original.id, PROJECT)).lifecycle_state, 'active');
      assert.equal((await db.listAtoms({ projectId: PROJECT, lifecycleStates: ['active'] })).length, 2);
    } finally { db.close(); }
  });

  test('an ambiguous collision escalates: a flagged candidate, and no change to the effective memory', async () => {
    const db = await store();
    try {
      const original = await seedEffective(db, { applies_to: { components: ['payments'] } });
      const before = await db.getAtom(original.id, PROJECT);
      // The proposal leaves open what the original declares. Nothing here decides
      // whether that is the same knowledge, so the reviewer does.
      const vague = await proposeMemory(proposal({
        topic_key: 'payments/retry/keys',
        behavior_delta: 'Keep using the first idempotency key.',
      }), { store: db });

      assert.equal(vague.decision, 'write');
      assert.ok(vague.reasons.includes('suspected_duplicate_pair'));
      assert.deepEqual(vague.atom.suspected_pair, [original.id]);
      assert.equal(vague.atom.replaces, undefined);
      // Untouched: same revision timestamp, same content, still effective.
      const after = await db.getAtom(original.id, PROJECT);
      assert.equal(after.updated_at, before.updated_at);
      assert.equal(after.lifecycle_state, 'active');
      assert.equal(after.behavior_delta, before.behavior_delta);
      assert.equal(after.superseded_by, undefined);
    } finally { db.close(); }
  });

  test('a near-duplicate candidate is flagged but is never a revision target', async () => {
    const db = await store();
    try {
      const first = await proposeMemory(proposal(), { store: db });
      assert.equal(first.decision, 'write');
      const second = await proposeMemory(proposal({
        topic_key: 'payments/retry/key-reuse',
        behavior_delta: 'Reuse the first idempotency key on every retry.',
      }), { store: db });
      // A candidate is not effective, so superseding it would mean nothing; the
      // pair is surfaced for review instead.
      assert.equal(second.decision, 'write');
      assert.deepEqual(second.atom.suspected_pair, [first.atom.id]);
      assert.equal(second.atom.replaces, undefined);
    } finally { db.close(); }
  });

  test('the threshold is read from config and a project can change it', async () => {
    const db = await store();
    try {
      const config = await db.loadConfig();
      assert.equal(config.health.trigger_collision.jaccard, 0.5);
      await db.saveConfig({ ...config, health: { ...config.health,
        trigger_collision: { ...config.health.trigger_collision, jaccard: 0.99 } } });

      await seedEffective(db);
      const paraphrase = await proposeMemory(proposal({
        topic_key: 'payments/retries/keys',
        trigger: 'when retrying a payment request',
        behavior_delta: 'Send the original idempotency key again.',
      }), { store: db });
      // Above the threshold the project chose, the same pair is a sibling again.
      assert.equal(paraphrase.decision, 'write');
      assert.equal(paraphrase.atom.replaces, undefined);
      assert.equal(paraphrase.collides_with.length, 0);
    } finally { db.close(); }
  });

  test('update is recorded in the admission decisions, not only returned', async () => {
    const db = await store();
    try {
      await seedEffective(db);
      await proposeMemory(proposal({
        topic_key: 'payments/retries/keys',
        trigger: 'when retrying a payment request',
        behavior_delta: 'Send the original idempotency key again.',
      }), { store: db });
      const decisions = await db.listAdmissions({ projectId: PROJECT });
      const update = decisions.find(d => d.decision === 'update');
      assert.ok(update, 'an update decision is logged');
      assert.ok(update.reasons.includes('trigger_collision_same_scope'));
    } finally { db.close(); }
  });
});
