import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';

describe('health snapshot', () => {
  test('loads compact atom columns and retrieval events without payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-health-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom({
      id: 'atom-1',
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/admission/required-fields',
      tags: ['memory'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
      evidence_refs: [{ source_type: 'file', source_ref: 'secret-path.js', summary: 'gate' }],
    });
    await store.logRetrieval({
      project_id: 'demo',
      action: 'before writing durable memory',
      intent: 'temporal',
      returned_atom_ids: ['atom-1'],
      abstained: false,
      budget_used: 10,
    });
    await store.putObservation({
      project_id: 'demo',
      source_type: 'tool_output',
      source_ref: 'edit',
      raw_preview: 'unreviewed note',
      promotion_status: 'unreviewed',
    });
    const snapshot = await store.loadHealthSnapshot('demo');
    assert.equal(snapshot.project_id, 'demo');
    assert.equal(snapshot.atoms[0].id, 'atom-1');
    assert.equal(snapshot.atoms[0].payload, undefined);
    assert.equal(snapshot.atoms[0].what, undefined);
    assert.equal(snapshot.atoms[0].evidence_refs, undefined);
    assert.deepEqual(snapshot.retrieval_events[0].returned_atom_ids, ['atom-1']);
    assert.equal(snapshot.observations.unreviewed, 1);
    assert.ok(snapshot.observations.oldest_at);
    store.close();
  });

  test('store.assessDeterioration does not dirty git or bump activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-health-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom({
      id: 'atom-1',
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/admission/required-fields',
      tags: ['memory'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    });
    const gitPath = join(root, '.dd', 'atoms', 'memory', 'admission', 'required-fields.json');
    const before = await readFile(gitPath, 'utf8');
    const report = await store.assessDeterioration('demo', { now: '2026-09-10T00:00:00.000Z' });
    assert.equal(report.status, 'healthy');
    assert.equal(report.indicators.some(row => row.id === 'cap_saturation' && row.status === 'skipped'), true);
    const after = await readFile(gitPath, 'utf8');
    assert.equal(after, before);
    const loaded = await store.getAtom('atom-1', 'demo');
    assert.equal(loaded.activation_count ?? 0, 0);
    store.close();
  });

  test('config health.live_bloat.watch override is honored', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-health-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    for (let i = 0; i < 5; i += 1) {
      await store.putAtom({
        id: `a${i}`,
        project_id: 'demo',
        memory_type: 'lesson',
        scope: 'project',
        title: `Lesson ${i}`,
        trigger: `when running unique module ${i} suite`,
        behavior_delta: 'keep isolation',
        what: `Fixture ${i}.`,
        why: `Isolation ${i}.`,
        authority: 'inferred',
        confidence: 0.8,
        valid_from: '2026-09-09T00:00:00.000Z',
        topic_key: `synth/load/item-${i}`,
        tags: ['synth'],
        lifecycle_state: 'active',
        retrieval_forms: { micro: `Synth ${i}.`, short: `Module ${i}.` },
      });
    }
    await store.saveConfig({ ...(await store.loadConfig()), health: { live_bloat: { watch: 3, deteriorated: 10 } } });
    const report = await store.assessDeterioration('demo', { now: '2026-09-10T00:00:00.000Z' });
    const bloat = report.indicators.find(row => row.id === 'live_bloat');
    assert.equal(bloat.status, 'watch');
    store.close();
  });

  test('fifty health runs do not bump activation or retrieval events', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-health-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom({
      id: 'atom-1',
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/admission/required-fields',
      tags: ['memory'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    });
    for (let i = 0; i < 50; i += 1) {
      await store.assessDeterioration('demo', { now: '2026-09-10T00:00:00.000Z' });
    }
    const loaded = await store.getAtom('atom-1', 'demo');
    assert.equal(loaded.activation_count ?? 0, 0);
    const snapshot = await store.loadHealthSnapshot('demo');
    assert.equal(snapshot.retrieval_events.length, 0);
    store.close();
  });
});
