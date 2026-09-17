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
