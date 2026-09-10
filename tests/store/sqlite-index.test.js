import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';

function atom(overrides = {}) {
  return {
    id: overrides.id ?? 'atom-1',
    project_id: overrides.project_id ?? 'demo',
    memory_type: 'lesson',
    scope: 'project',
    title: overrides.title ?? 'Require trigger',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first',
    what: 'Durable memory needs a trigger.',
    why: 'Stops V1 dumps.',
    authority: 'inferred',
    confidence: 0.8,
    valid_from: '2026-09-09T00:00:00.000Z',
    topic_key: overrides.topic_key ?? 'memory/admission/required-fields',
    tags: ['memory'],
    lifecycle_state: 'active',
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'Admission gate' }],
    ...overrides,
  };
}

describe('MemoryStore sqlite index', () => {
  test('indexes git atoms and searches without crossing projects', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-idx-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom(atom());
    await store.putAtom(atom({
      id: 'atom-other',
      project_id: 'other',
      topic_key: 'memory/other/topic',
      title: 'Other project trigger lesson',
    }));
    const hits = await store.search({ projectId: 'demo', query: 'trigger' });
    assert.ok(hits.some(h => h.id === 'atom-1'));
    assert.ok(hits.every(h => h.project_id === 'demo'));
    store.close();
  });

  test('rebuilds the index from files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-idx-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom(atom());
    store.close();

    const reopened = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const loaded = await reopened.getAtom('atom-1', 'demo');
    assert.equal(loaded.title, 'Require trigger');
    const counted = await reopened.reindex();
    assert.equal(counted.atoms, 1);
    reopened.close();
  });

  test('retrieve does not rewrite git atoms for activation telemetry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-idx-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom(atom());
    const gitPath = join(root, '.dd', 'atoms', 'memory', 'admission', 'required-fields.json');
    const before = await readFile(gitPath, 'utf8');
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'before writing durable memory',
    }, { store });
    assert.equal(retrieved.abstained, false);
    const after = await readFile(gitPath, 'utf8');
    assert.equal(after, before);
    const indexed = await store.getAtom('atom-1', 'demo');
    assert.equal(indexed.activation_count, 1);
    await store.reindex();
    const preserved = await store.getAtom('atom-1', 'demo');
    assert.equal(preserved.activation_count, 1);
    const gitAtom = JSON.parse(await readFile(gitPath, 'utf8'));
    assert.equal(gitAtom.activation_count ?? 0, 0);
    store.close();
  });

  test('getAtom reads sqlite and does not fall back to a git walk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-idx-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom(atom());
    store.index.removeAtom('atom-1');
    assert.equal(await store.getAtom('atom-1', 'demo'), null);
    store.close();
  });

  test('registry, relations, live topic, and counts read from sqlite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-idx-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const entry = await store.createRegistryEntry('demo', 'memory/compaction', 'provisional');
    await store.createAlias(entry.id, 'demo', 'memoria/compactacion', 'alias');
    const hits = await store.findAliasOccurrences('demo', 'revisar memoria/compactacion ahora');
    assert.equal(hits.length, 1);
    assert.equal(hits[0].canonical_key, 'memory/compaction');
    const siblings = await store.getAliasesForRegistryIds([entry.id]);
    assert.ok(siblings.some(row => row.alias === 'memoria/compactacion'));

    await store.putAtom(atom());
    await store.putAtom(atom({
      id: 'atom-2',
      topic_key: 'memory/admission/other-fields',
      lifecycle_state: 'contested',
    }));
    await store.putRelation({
      source_atom_id: 'atom-1',
      relation_type: 'contradicts',
      target_atom_id: 'atom-2',
    });
    const rels = await store.listRelations({ atomIds: ['atom-1'] });
    assert.equal(rels.length, 1);
    assert.equal(rels[0].relation_type, 'contradicts');

    const live = await store.listByTopicLive('demo', 'memory/admission/required-fields');
    assert.equal(live.length, 1);
    assert.equal(live[0].id, 'atom-1');

    assert.equal(await store.countAtoms({ projectId: 'demo', lifecycleStates: ['active'] }), 1);
    const counted = await store.countByLifecycle('demo');
    assert.equal(counted.counts.active, 1);
    assert.equal(counted.counts.contested, 1);
    assert.equal(counted.total, 2);
    store.close();
  });

  test('retrieve honors config vpt_threshold', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-idx-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom(atom());
    await store.saveConfig({ ...(await store.loadConfig()), vpt_threshold: 0.9 });
    const retrieved = await retrieveMemories({
      project_id: 'demo',
      action: 'before writing durable memory',
    }, { store });
    assert.equal(retrieved.abstained, true);
    store.close();
  });
});
