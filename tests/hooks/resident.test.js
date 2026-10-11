import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureResident, projectUiUrl } from '../../src/resident.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startResidentServer, startUiServer } from '../../src/ui/server.js';
import { callRunningStore } from '../../src/hooks/bridge.js';
import { projectKey } from '../../src/project.js';
import { registerResident, uiCookie, useTempRegistry } from '../helpers/resident.js';

// These tests decide DD_RESIDENT and DD_RETRIEVAL themselves: an inherited
// DD_RESIDENT=0 or DD_RETRIEVAL=lexical would change what they exercise.
function realMode(t) {
  const saved = { resident: process.env.DD_RESIDENT, retrieval: process.env.DD_RETRIEVAL };
  delete process.env.DD_RESIDENT;
  delete process.env.DD_RETRIEVAL;
  t.after(() => {
    for (const [key, name] of [['resident', 'DD_RESIDENT'], ['retrieval', 'DD_RETRIEVAL']]) {
      if (saved[key] === undefined) delete process.env[name]; else process.env[name] = saved[key];
    }
  });
}
async function project(name) {
  const root = join(await mkdtemp(join(tmpdir(), 'dd-resident-')), name);
  await mkdir(join(root, '.git'), { recursive: true });
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  return { root, store };
}

test('no live resident gets one started; a live one of this build is reused', async t => {
  realMode(t);
  await useTempRegistry(t);
  const started = [];
  assert.equal((await ensureResident(null, { start: () => started.push(1) })).state, 'started');
  const { store } = await project('a');
  const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await registerResident(t, ui);
  const second = await ensureResident(null, { start: () => started.push(1) });
  assert.equal(second.state, 'live');
  assert.equal(started.length, 1);
});

test('a resident whose code changed since it started is replaced, not reused', async t => {
  realMode(t);
  const { store } = await project('b');
  let code = 'v1';
  const ui = await startUiServer({ store, projectId: 'demo', port: 0, fingerprint: async () => code, staleCheckMs: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await registerResident(t, ui);
  const started = [];
  assert.equal((await ensureResident(null, { start: () => started.push(1) })).state, 'live');
  code = 'v2';
  const result = await ensureResident(null, { start: () => started.push(1) });
  assert.equal(result.state, 'started');
  assert.equal(result.replaced, true);
});

test('DD_RESIDENT=0 disables starting one', async t => {
  realMode(t);
  process.env.DD_RESIDENT = '0';
  const result = await ensureResident(null, { start: () => assert.fail('must not start') });
  assert.equal(result.state, 'disabled');
});

// One resident, many projects, each from its own store; the model loads once.
test('one resident serves several projects, each from its own store', async t => {
  realMode(t);
  const a = await project('alpha');
  const b = await project('beta');
  a.store.close(); b.store.close();
  const opened = [];
  const openProject = async (repoRoot, dataDir) => {
    opened.push(repoRoot);
    const store = await createMemoryStore({ ddDir: join(repoRoot, '.dd'), dataDir, repoRoot });
    return { store, projectId: `id-${opened.length}` };
  };
  let created = 0;
  const createRetrieve = () => { created += 1; const r = async () => ({ memories: [] }); r.warm = async () => true; r.preload = async () => true; return r; };
  const server = await startResidentServer({ openProject, port: 0, semantic: true, createRetrieve });
  t.after(() => server.close());
  await registerResident(t, server);
  await new Promise(resolve => setTimeout(resolve, 20));
  for (const root of [a.root, b.root, a.root]) {
    assert.notEqual(await callRunningStore('retrieve', { action: 'edit the parser' }, root), null);
  }
  assert.equal(opened.length, 2);
  assert.equal(created, 1);
  assert.equal(server.projects.size, 2);
  // The audit UI is addressed per project.
  const url = await projectUiUrl(b.root);
  assert.ok(url.endsWith(`?project=${projectKey(b.root).key}&key=${server.uiKey}`));
  const status = await (await fetch(`${server.url}/api/status?project=${projectKey(b.root).key}`, { headers: uiCookie(server) })).json();
  assert.equal(status.project_id, 'id-2');
  assert.equal((await fetch(`${server.url}/api/status`, { headers: uiCookie(server) })).status, 400);
});

// Two installs on one machine (a plugin and a checkout, or two hosts) replaced
// each other's resident at every session start and reloaded the model. Installs
// of one version now share it; a newer one is left in place.
test('a resident serves every install of its version and is kept when newer', async () => {
  const { residentFit } = await import('../../src/resident.js');
  const { BUILD_ID, VERSION, compareVersions } = await import('../../src/hooks/build.js');
  const other = 'f'.repeat(16);
  const bump = v => v.split('.').map((n, i) => i === 1 ? Number(n) + 1 : n).join('.');
  assert.equal(residentFit(null), 'none');
  assert.equal(residentFit({ build: BUILD_ID, version: VERSION, stale: false }), 'live');
  assert.equal(residentFit({ build: other, version: VERSION, stale: false }), 'live');
  assert.equal(residentFit({ build: other, version: VERSION, stale: true }), 'replace');
  assert.equal(residentFit({ build: other, version: '0.0.1', stale: false }), 'replace');
  assert.equal(residentFit({ build: other, version: null, stale: false }), 'replace');
  assert.equal(residentFit({ build: other, version: bump(VERSION), stale: false }), 'superseded');
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.equal(compareVersions('0.3.1', '0.3.1'), 0);
});
