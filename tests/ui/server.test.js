import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { proposeMemory } from '../../src/engine/write.js';

async function json(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json() };
}

describe('audit UI HTTP', () => {
  test('lists, admits, edits, and deletes an atom on disk', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-ui-'));
    const store = await createMemoryStore({
      supermemDir: join(root, '.supermem'),
      dataDir: join(root, 'data'),
    });
    const written = await proposeMemory({
      project_id: 'demo',
      memory_type: 'lesson',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      topic_key: 'memory/admission/required-fields',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'gate' }],
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    }, { store });

    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    const base = ui.url;

    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.match(await home.text(), /SuperMem audit/);

    const list = await json(base + '/api/atoms');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);

    const admitted = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST' });
    assert.equal(admitted.body.lifecycle_state, 'active');

    const patched = await json(base + '/api/atoms/' + written.atom.id, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Require trigger always' }),
    });
    assert.equal(patched.status, 200);

    const deleted = await json(base + '/api/atoms/' + written.atom.id, { method: 'DELETE' });
    assert.equal(deleted.body.deleted, true);

    const empty = await json(base + '/api/atoms');
    assert.equal(empty.body.length, 0);

    await ui.close();
    store.close();
  });
});
