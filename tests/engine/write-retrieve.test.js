import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';

function proposal(overrides = {}) {
  return {
    project_id: 'demo',
    memory_type: 'lesson',
    scope: 'project',
    title: 'Require trigger',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger, behavior_delta, evidence, and forms first',
    what: 'Durable memory must be behavioral.',
    why: 'Avoids V1 contamination.',
    topic_key: 'memory/admission/required-fields',
    tags: ['memory'],
    evidence_refs: [{
      source_type: 'file',
      source_ref: 'src/engine/v2/admission.js',
      summary: 'Admission gate',
    }],
    retrieval_forms: {
      micro: 'Require trigger.',
      short: 'Validate trigger before active memory.',
      full: 'Full admission rationale.',
    },
    ...overrides,
  };
}

async function store() {
  const root = await mkdtemp(join(tmpdir(), 'dd-wr-'));
  return createMemoryStore({
    ddDir: join(root, '.dd'),
    dataDir: join(root, 'data'),
  });
}

describe('propose + retrieve', () => {
  test('admits a complete lesson and retrieves it by trigger', async () => {
    const db = await store();
    const result = await proposeMemory(proposal(), { store: db });
    assert.equal(result.decision, 'write');
    assert.equal(result.atom.lifecycle_state, 'candidate');

    await db.putAtom({ ...result.atom, lifecycle_state: 'active' });
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'before writing durable memory',
    }, { store: db });
    assert.equal(retrieved.abstained, false);
    assert.match(retrieved.memories[0].content, /validate trigger, behavior_delta, evidence, and forms first/);
    assert.equal(retrieved.memories[0].topic_key, 'memory/admission/required-fields');
    assert.equal(retrieved.memories[0].evidence_refs, undefined);
    assert.equal(retrieved.memories[0].retrieval_forms, undefined);
    assert.equal(retrieved.memories[0].what, undefined);
    assert.ok(retrieved.budget.used > 0);
    db.close();
  });

  test('reports trigger collisions against other live atoms', async () => {
    const db = await store();
    const first = await proposeMemory(proposal({
      trigger: 'writing durable memory tests',
      topic_key: 'eval/collide/one',
    }), { store: db });
    await db.putAtom({ ...first.atom, lifecycle_state: 'active' });
    const second = await proposeMemory(proposal({
      id: 'atom-2',
      title: 'Sister lesson',
      trigger: 'writing durable unit tests',
      topic_key: 'eval/collide/two',
    }), { store: db });
    assert.equal(second.decision, 'write');
    assert.equal(second.collides_with.length, 1);
    assert.equal(second.collides_with[0].id, first.atom.id);
    db.close();
  });

  test('does not activate a proposal missing trigger', async () => {
    const db = await store();
    const result = await proposeMemory(proposal({ trigger: '' }), { store: db });
    assert.equal(result.decision, 'observe');
    assert.equal(result.atom, null);
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'before writing durable memory',
    }, { store: db });
    assert.equal(retrieved.abstained, true);
    db.close();
  });

  test('abstains when nothing is worth the tokens', async () => {
    const db = await store();
    await proposeMemory(proposal(), { store: db });
    const atom = (await db.listAtoms({ projectId: 'demo' }))[0];
    await db.putAtom({ ...atom, lifecycle_state: 'active' });
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'unrelated cooking recipe',
      budget_tokens: 20,
    }, { store: db, vptThreshold: 0.5 });
    assert.equal(retrieved.abstained, true);
    assert.equal(retrieved.memories.length, 0);
    db.close();
  });

  test('keeps the active topic until its replacement is reviewed', async () => {
    const db = await store();
    const first = await proposeMemory(proposal(), { store: db });
    await db.putAtom({ ...first.atom, lifecycle_state: 'active' });
    const second = await proposeMemory(proposal({
      id: 'atom-2',
      behavior_delta: 'always validate trigger, evidence, and forms before write',
      what: 'The gate is stricter now.',
    }), { store: db });
    assert.equal(second.decision, 'write');
    assert.equal(second.atom.replaces, first.atom.id);
    assert.equal((await db.getAtom(first.atom.id, 'demo')).lifecycle_state, 'active');
    await admitMemory(second.atom.id, { store: db, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Reviewed stricter gate.' });
    const old = await db.getAtom(first.atom.id, 'demo');
    assert.equal(old.lifecycle_state, 'superseded');
    db.close();
  });

  test('caps injected hits even when many atoms share a trigger', async () => {
    const db = await store();
    for (let i = 0; i < 20; i += 1) {
      const written = await proposeMemory(proposal({
        id: `cap-${i}`,
        topic_key: `memory/admission/cap-${i}`,
        title: `Cap lesson ${i}`,
      }), { store: db });
      await db.putAtom({ ...written.atom, lifecycle_state: 'active' });
    }
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'before writing durable memory',
    }, { store: db });
    assert.equal(retrieved.abstained, false);
    assert.ok(retrieved.memories.length <= 8);
    db.close();
  });

  test('retrieve at 1000 atoms finds the needle without dumping full atoms', async () => {
    const db = await store();
    const needle = await proposeMemory(proposal({ id: 'needle' }), { store: db });
    await db.putAtom({ ...needle.atom, lifecycle_state: 'active' });
    // Newer filler rows must outrank the needle in listAtoms(updated_at DESC)
    // so a git/SQLite table-scan fallback of 50 cannot accidentally return it.
    for (let i = 0; i < 1000; i += 1) {
      db.index.upsertAtom({
        ...proposal({
          id: `load-${i}`,
          topic_key: `synth/load/item-${i}`,
          title: `Synthetic ${i}`,
          trigger: `when running unit tests in module ${i}`,
          what: `Synthetic fixture ${i}.`,
          why: `Load-test isolation ${i}.`,
          retrieval_forms: { micro: `Synth ${i}.`, short: `Run tests in module ${i}.` },
        }),
        authority: 'inferred',
        confidence: 0.7,
        valid_from: '2026-09-09T00:00:00.000Z',
        lifecycle_state: 'active',
        created_at: '2026-09-09T00:00:00.000Z',
        updated_at: '2099-01-01T00:00:00.000Z',
      });
    }

    const started = Date.now();
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'before writing durable memory',
    }, { store: db });
    const elapsed = Date.now() - started;

    assert.equal(retrieved.abstained, false);
    assert.ok(retrieved.memories.some(hit => hit.id === 'needle' || hit.topic_key === 'memory/admission/required-fields'));
    assert.ok(retrieved.memories.length <= 8);
    assert.ok(retrieved.memories.every(hit => hit.evidence_refs === undefined));
    assert.ok(elapsed < 1000, `retrieve took ${elapsed}ms`);
    db.close();
  });

  test('does not retrieve another project', async () => {
    const db = await store();
    const written = await proposeMemory(proposal(), { store: db });
    await db.putAtom({ ...written.atom, lifecycle_state: 'active' });
    const retrieved = await retrieveMemories({
      project_id: 'other',
      action: 'before writing durable memory',
    }, { store: db });
    assert.equal(retrieved.memories.length, 0);
    db.close();
  });
});
