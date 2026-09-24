import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { fileActions } from '../../src/engine/actions.js';
import { proposeMemory } from '../../src/engine/write.js';
import { uiCookie } from '../helpers/resident.js';
import { PROVENANCE } from '../helpers/atom.js';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-ui-actions-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  await store.putAtom({ id: 'u1', project_id: 'demo', memory_type: 'lesson', scope: 'project', title: 'Old install flow',
    trigger: 'when installing', behavior_delta: 'Run the old installer.', what: 'W.', why: 'Y.', authority: 'validated',
    confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: 'demo/install/flow', tags: [], evidence_refs: [],
    trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
    ...PROVENANCE, lifecycle_state: 'active' });
  const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  const cookie = uiCookie(ui);
  const html = await (await fetch(ui.url + '/', { headers: cookie })).text();
  const token = html.match(/name="dd-review-token" content="([a-f0-9]+)"/)[1];
  const call = async (path, body, { review = true } = {}) => {
    const res = await fetch(ui.url + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...cookie, 'content-type': 'application/json', ...(review ? { 'x-dd-review-token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: await res.json() };
  };
  return { store, call };
}

// The reviewer applies, rejects or sends back what the agent filed; nothing else can.
test('actions are listed, revised, rejected and applied only through the review token', async t => {
  const { store, call } = await setup(t);
  const [a1, a2] = await fileActions([
    { kind: 'archive', targets: ['u1'], archived_reason: 'Replaced by the plugin install.', rationale: 'The user asked.' },
    { kind: 'legacy', targets: ['u1'], legacy_reason: 'The old installer broke on Windows.', rationale: 'The user asked.' },
  ], { store, projectId: 'demo' });
  const listed = await call('/api/actions');
  assert.equal(listed.body.length, 2);
  assert.deepEqual(listed.body[0].target_atoms[0], { id: 'u1', title: 'Old install flow', topic_key: 'demo/install/flow', lifecycle_state: 'active' });
  assert.equal((await call(`/api/actions/${a1.id}/apply`, {}, { review: false })).status, 403);
  assert.equal((await call(`/api/actions/${a1.id}/revise`, { reason: '' })).body.error, 'revision_reason_required');
  assert.equal((await call(`/api/actions/${a1.id}/revise`, { reason: 'Name what replaced it.' })).status, 200);
  assert.equal((await call(`/api/actions/${a1.id}/apply`, {})).body.error, 'revision_requested');
  assert.equal((await call(`/api/actions/${a2.id}/apply`, { rationale: 'Agreed.' })).status, 200);
  assert.equal((await store.getAtom('u1', 'demo')).lifecycle_state, 'legacy');
  assert.equal((await call(`/api/actions/${a1.id}/reject`, { note: 'Already legacy.' })).status, 200);
  assert.deepEqual((await call('/api/actions')).body, []);
  assert.deepEqual((await call('/api/status')).body.archive_review, { archived: 0, threshold: 50, due: false });
});

test('a candidate memory can be sent back with a reason', async t => {
  const { store, call } = await setup(t);
  const { atom } = await proposeMemory({ project_id: 'demo', topic_key: 'demo/install/new', trigger: 'when installing the plugin',
    behavior_delta: 'Use the marketplace.', why: 'It installs dependencies.', capture_origin: 'model_initiated',
    evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] }, { store });
  assert.equal((await call(`/api/atoms/${atom.id}/revise`, { reason: 'Say which marketplace.' })).status, 200);
  assert.equal((await store.getAtom(atom.id, 'demo')).revision_requested.reason, 'Say which marketplace.');
  assert.equal((await call(`/api/atoms/${atom.id}/admit`, { rationale: 'ok' })).body.error, 'revision_requested');
});
