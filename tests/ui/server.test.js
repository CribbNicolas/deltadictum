import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { proposeMemory } from '../../src/engine/write.js';
import { Script } from 'node:vm';

async function json(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json() };
}

describe('audit UI HTTP', () => {
  test('local review approves candidates and editing preserves the effective version', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const written = await proposeMemory({
      project_id: 'demo',
      capture_origin: 'model_initiated',
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
    t.after(async () => { await ui.close(); store.close(); });
    const base = ui.url;

    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /DeltaDictum audit/);
    assert.match(html, /id="origin-filter"/);
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new Script(script[1]);
    const token = html.match(/name="dd-review-token" content="([a-f0-9]+)"/)[1];
    const headers = { 'content-type': 'application/json', 'x-dd-review-token': token };

    const list = await json(base + '/api/atoms');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].capture_origin, 'model_initiated');

    const denied = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST' });
    assert.equal(denied.status, 403);
    const wrongOrigin = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST',
      headers: { ...headers, origin: 'http://unrelated.example' }, body: JSON.stringify({ rationale: 'Cross-origin request' }) });
    assert.equal(wrongOrigin.status, 403);
    const admitted = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST', headers, body: JSON.stringify({ rationale: 'Reviewed against the gate.' }) });
    assert.equal(admitted.body.lifecycle_state, 'active');
    assert.equal(admitted.body.capture_origin, 'model_initiated');
    assert.equal(admitted.body.capture_source, 'agent');

    const patched = await json(base + '/api/atoms/' + written.atom.id, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ why: 'A newly reviewed reason.', capture_origin: 'model_initiated', capture_source: 'agent' }),
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.atom.lifecycle_state, 'candidate');
    assert.equal(patched.body.atom.capture_origin, 'user_explicit');
    assert.equal(patched.body.atom.capture_source, 'local_ui');
    assert.equal((await store.getAtom(written.atom.id, 'demo')).lifecycle_state, 'active');
    const filtered = await json(base + '/api/atoms?capture_origin=user_explicit&lifecycle=candidate');
    assert.deepEqual(filtered.body.map(a => a.id), [patched.body.atom.id]);
    assert.deepEqual((await json(base + '/api/atoms?capture_origin=user_explicit&lifecycle=active')).body, []);

    const deleted = await json(base + '/api/atoms/' + patched.body.atom.id, { method: 'DELETE', headers });
    assert.equal(deleted.body.deleted, true);

    const empty = await json(base + '/api/atoms');
    assert.equal(empty.body.length, 1);
    assert.equal(empty.body[0].id, written.atom.id);
  });
});
