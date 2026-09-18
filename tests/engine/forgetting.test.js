import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';
import { archiveMemory, admitMemory, restoreMemory, retireByDisuse, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { cappedConfidence } from '../../src/engine/reliability.js';
import { archiveFilePath } from '../../src/store/paths.js';

const PROJECT = 'forget';

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
  const root = await mkdtemp(join(tmpdir(), 'dd-forget-'));
  return createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
}

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString();
}

// Review is what makes a memory effective. These tests seed what review writes,
// then backdate `created_at` and set the usage history the seeding path cannot.
async function seedEffective(db, { authority = 'inferred', age_days = 400, activation_count = 0, ...overrides } = {}) {
  const written = await proposeMemory(proposal(overrides), { store: db });
  assert.equal(written.decision, 'write');
  const atom = await db.putAtom({ ...written.atom, lifecycle_state: 'active', authority,
    confidence: cappedConfidence(written.atom, { authority }),
    created_at: daysAgo(age_days), activation_count });
  // `created_at` is immutable in the index, so a backdated write only reaches the
  // health snapshot through a rebuild from git — which is where the truth is.
  await db.reindex();
  return atom;
}

async function setRetirementPolicy(db, retirement) {
  const config = await db.loadConfig();
  await db.saveConfig({ ...config, health: { ...config.health, retirement } });
}

async function logRetrievals(db, count) {
  for (let i = 0; i < count; i += 1) {
    await db.logRetrieval({ project_id: PROJECT, returned_atom_ids: [], abstained: true, budget_used: 0 });
  }
}

// The whole point of the stage: the trigger must have had chances to fire, so
// every retirement test needs a project with a retrieval history.
const REACHABLE = { min_age_days: 90, min_retrieval_events: 3 };

describe('forgetting by disuse', () => {
  test('authority protects: a canonical memory is never retired, however old and unused', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db, { authority: 'canonical', age_days: 900 });
      await setRetirementPolicy(db, { min_age_days: 1, min_retrieval_events: 0 });
      await logRetrievals(db, 5);

      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), []);
      assert.equal((await db.getAtom(atom.id, PROJECT)).lifecycle_state, 'active');
      await assert.rejects(archiveMemory(atom.id, { store: db, projectId: PROJECT }), /authority_protected/);
    } finally { db.close(); }
  });

  test('a validated memory is protected too: review, not usage, is what put it there', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db, { authority: 'validated' });
      await setRetirementPolicy(db, { min_age_days: 1, min_retrieval_events: 0 });

      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), []);
      assert.equal((await db.getAtom(atom.id, PROJECT)).lifecycle_state, 'active');
    } finally { db.close(); }
  });

  test('an inferred memory past the age threshold that never activated is archived', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db, { authority: 'inferred', age_days: 400 });
      await setRetirementPolicy(db, REACHABLE);
      await logRetrievals(db, 4);

      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), [atom.id]);
      const retired = await db.getAtom(atom.id, PROJECT);
      assert.equal(retired.lifecycle_state, 'archived');
      assert.equal(retired.archived_reason, 'never_activated');
      assert.ok(retired.archived_at);
    } finally { db.close(); }
  });

  test('one activation is enough to keep a memory, however old', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db, { authority: 'inferred', age_days: 900, activation_count: 1 });
      await setRetirementPolicy(db, { min_age_days: 1, min_retrieval_events: 0 });
      await logRetrievals(db, 4);

      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), []);
      assert.equal((await db.getAtom(atom.id, PROJECT)).lifecycle_state, 'active');
    } finally { db.close(); }
  });

  test('a trigger with no chances to fire is not disused: retirement waits for retrieval history', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db, { authority: 'inferred', age_days: 900 });
      await setRetirementPolicy(db, REACHABLE);
      await logRetrievals(db, 2);

      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), []);
      assert.equal((await db.getAtom(atom.id, PROJECT)).lifecycle_state, 'active');
    } finally { db.close(); }
  });

  test('thresholds come from config and a project can raise them out of reach', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db, { authority: 'inferred', age_days: 100 });
      await logRetrievals(db, 4);
      await setRetirementPolicy(db, { min_age_days: 365, min_retrieval_events: 3 });
      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), []);

      await setRetirementPolicy(db, { min_age_days: 90, min_retrieval_events: 3 });
      assert.deepEqual(await retireByDisuse({ store: db, projectId: PROJECT }), [atom.id]);
    } finally { db.close(); }
  });

  test('archiving is not deleting: the git file survives and the memory is restorable', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db);
      await archiveMemory(atom.id, { store: db, projectId: PROJECT });

      const file = await stat(archiveFilePath(db.ddDir, atom.id));
      assert.ok(file.isFile());
      assert.equal((await db.getAtom(atom.id, PROJECT)).lifecycle_state, 'archived');

      const restored = await restoreMemory(atom.id, { store: db, projectId: PROJECT, actor: HUMAN_REVIEW });
      assert.equal(restored.lifecycle_state, 'active');
      assert.equal(restored.archived_at, null);
    } finally { db.close(); }
  });

  test('restoring is a review action, not something an agent can ask for', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db);
      await archiveMemory(atom.id, { store: db, projectId: PROJECT });
      await assert.rejects(restoreMemory(atom.id, { store: db, projectId: PROJECT }), /human_review_required/);
    } finally { db.close(); }
  });

  test('an archived memory leaves the retrieval surface, and restoring brings it back', async () => {
    const db = await store();
    try {
      const atom = await seedEffective(db);
      const before = await retrieveMemories({ project_id: PROJECT, action: 'when retrying payment requests', telemetry: false }, { store: db });
      assert.equal(before.abstained, false);
      assert.equal(before.memories[0].topic_key, 'payments/retry/idempotency');

      await archiveMemory(atom.id, { store: db, projectId: PROJECT });
      const during = await retrieveMemories({ project_id: PROJECT, action: 'when retrying payment requests', telemetry: false }, { store: db });
      assert.equal(during.abstained, true);
      assert.deepEqual(during.memories, []);

      await restoreMemory(atom.id, { store: db, projectId: PROJECT, actor: HUMAN_REVIEW });
      const after = await retrieveMemories({ project_id: PROJECT, action: 'when retrying payment requests', telemetry: false }, { store: db });
      assert.equal(after.abstained, false);
      assert.equal(after.memories[0].topic_key, 'payments/retry/idempotency');
    } finally { db.close(); }
  });

  test('archiving frees the topic_key, and a restore cannot take it back', async () => {
    const db = await store();
    try {
      const first = await seedEffective(db);
      await archiveMemory(first.id, { store: db, projectId: PROJECT });
      await seedEffective(db, { title: 'Send the same idempotency key', behavior_delta: 'Send the stored key again.' });

      await assert.rejects(restoreMemory(first.id, { store: db, projectId: PROJECT, actor: HUMAN_REVIEW }), /topic_key_taken/);
      assert.equal((await db.getAtom(first.id, PROJECT)).lifecycle_state, 'archived');
    } finally { db.close(); }
  });

  test('archiving a memory sends a pending revision of it back to review', async () => {
    const db = await store();
    try {
      const original = await seedEffective(db);
      const revision = await proposeMemory(proposal({
        title: 'Keep the idempotency key when retrying',
        behavior_delta: 'Send the original idempotency key again.',
      }), { store: db });
      assert.equal(revision.atom.replaces, original.id);

      await archiveMemory(original.id, { store: db, projectId: PROJECT });
      await assert.rejects(admitMemory(revision.atom.id, { store: db, projectId: PROJECT,
        actor: HUMAN_REVIEW, rationale: 'Reads better.' }), /replacement_changed_review_again/);
    } finally { db.close(); }
  });

  test('the write path still succeeds when retirement evaluation throws', async () => {
    const db = await store();
    try {
      db.loadHealthSnapshot = () => { throw new Error('index_unavailable'); };
      const written = await proposeMemory(proposal(), { store: db });
      assert.equal(written.decision, 'write');
      assert.equal(written.atom.lifecycle_state, 'candidate');
    } finally { db.close(); }
  });

  test('a write sweeps what has fallen out of use, without a worker', async () => {
    const db = await store();
    try {
      const stale = await seedEffective(db, { authority: 'inferred', age_days: 400 });
      await setRetirementPolicy(db, REACHABLE);
      await logRetrievals(db, 4);

      await proposeMemory(proposal({ topic_key: 'payments/refund/window',
        title: 'Refund inside the settlement window', trigger: 'when refunding a settled payment',
        behavior_delta: 'Refund through the settlement API, not the charge API.',
        what: 'Settled payments refund differently.', why: 'The charge API rejects settled charges.' }), { store: db });

      assert.equal((await db.getAtom(stale.id, PROJECT)).lifecycle_state, 'archived');
    } finally { db.close(); }
  });
});
