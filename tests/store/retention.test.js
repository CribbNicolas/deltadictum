import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';

test('observations and live retrieval telemetry remain bounded without altering knowledge', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-retention-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  await store.saveConfig({ capture: { max_observations: 3 }, telemetry: { max_events: 4 } });
  for (let i = 0; i < 8; i++) {
    await store.putObservation({ project_id: 'demo', source_type: 'validation', source_ref: `test-${i}`, raw_preview: 'Passed.' });
    await store.logRetrieval({ project_id: 'demo', action: 'testing', returned_atom_ids: [], abstained: true });
  }
  assert.equal(store.index.db.prepare('SELECT COUNT(*) AS n FROM memory_observations').get().n, 3);
  assert.equal(store.index.db.prepare('SELECT COUNT(*) AS n FROM memory_retrieval_events').get().n, 4);
  assert.equal(await store.countAtoms({ projectId: 'demo' }), 0);
});

test('the contradiction audit log survives the telemetry retention policy', async t => {
  // Contradiction rows record Level 3 human decisions and their rationale. They
  // are audit, not telemetry, so neither the event cap nor the age window may
  // remove them.
  const root = await mkdtemp(join(tmpdir(), 'dd-audit-retention-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  await store.saveConfig({ telemetry: { retention_days: 1, max_events: 2 } });

  for (let i = 0; i < 6; i++) {
    await store.logContradiction({ project_id: 'demo', atom_a_id: `a-${i}`, atom_b_id: `b-${i}`,
      detection_source: 'explicit', action: 'contested', reasons: ['explicit_contradiction'] });
  }
  // Writing the log does not itself prune; a telemetry write is what triggers it.
  await store.logRetrieval({ project_id: 'demo', action: 'testing', returned_atom_ids: [], abstained: true });
  assert.equal(store.index.db.prepare('SELECT COUNT(*) AS n FROM memory_contradiction_log').get().n, 6,
    'the event cap must not discard resolution history');

  // Age a row well past the telemetry window and force another prune.
  const ancient = new Date(Date.now() - 400 * 86400000).toISOString();
  store.index.db.prepare('UPDATE memory_contradiction_log SET created_at = ? WHERE atom_a_id = ?').run(ancient, 'a-0');
  await store.logRetrieval({ project_id: 'demo', action: 'testing', returned_atom_ids: [], abstained: true });
  assert.equal(store.index.db.prepare('SELECT COUNT(*) AS n FROM memory_contradiction_log WHERE atom_a_id = ?').get('a-0').n, 1,
    'the age window must not discard resolution history');

  // The ordinary telemetry tables stay bounded.
  assert.ok(store.index.db.prepare('SELECT COUNT(*) AS n FROM memory_retrieval_events').get().n <= 2);
});
