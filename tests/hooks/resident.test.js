import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureResident, projectUiUrl, writeRegistry } from '../../src/resident.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startResidentServer, startUiServer } from '../../src/ui/server.js';
import { residentNotice, isInactive, buildSessionStartContext } from '../../src/hooks/session-start.js';
import { callRunningStore } from '../../src/hooks/bridge.js';
import { projectKey } from '../../src/project.js';
import { registerResident, useTempRegistry } from '../helpers/resident.js';

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

// Embeddings are required (2026-09-23): without a ready resident DD is inactive,
// and SessionStart says why and how to fix it.
test('DD is inactive, and says so, until a resident with its model is serving', async t => {
  realMode(t);
  assert.match(residentNotice({ state: 'started' }), /Inactive for now.*README > "Resident process"/);
  assert.match(residentNotice({ state: 'live', retrieval: 'loading' }), /loading its embedding model/);
  assert.match(residentNotice({ state: 'live', retrieval: 'unavailable' }), /could not load its embedding model/);
  assert.match(residentNotice({ state: 'unreachable' }), /not answering/);
  assert.match(residentNotice({ state: 'disabled' }), /DD_RESIDENT=0/);
  assert.equal(residentNotice({ state: 'live', retrieval: 'semantic' }), null);
  assert.equal(isInactive({ state: 'live', retrieval: 'semantic' }), false);

  const { store } = await project('c');
  t.after(() => store.close());
  const start = await buildSessionStartContext({ store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 's', resident: { state: 'started' } });
  const text = start.hookSpecificOutput.additionalContext;
  assert.match(text, /DD - Inactive for now/);
  assert.doesNotMatch(text, /Project context/);

  process.env.DD_RETRIEVAL = 'lexical';
  assert.equal(isInactive({ state: 'started' }), false);
});

// The registry is rewritten only once a new resident is listening, so at the
// session start that replaces (or fails to start) one it still names the old,
// dead address. SessionStart must not hand that address to the person.
test('SessionStart names no audit URL for a resident that is not live', async t => {
  realMode(t);
  const registry = await useTempRegistry(t);
  const { root, store } = await project('d');
  store.close();
  await writeRegistry({ url: 'http://127.0.0.1:1', port: 1, hookToken: 'a'.repeat(64) });
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url)), 'session-start'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, DD_RESIDENT: '0', DD_RESIDENT_REGISTRY: registry, DD_DATA: join(root, 'data') } });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve(JSON.parse(text)));
    child.stdin.end(JSON.stringify({ cwd: root, session_id: 's' }));
  });
  const text = output.hookSpecificOutput.additionalContext;
  assert.match(text, /DD - Inactive: the resident DD process is disabled/);
  assert.doesNotMatch(text, /127\.0\.0\.1:1\b/);
  assert.doesNotMatch(text, /tell the user this URL/);
  assert.equal(output.systemMessage, undefined);
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
    assert.notEqual(await callRunningStore('session-start', { session_id: 's' }, root), null);
  }
  assert.equal(opened.length, 2);
  assert.equal(created, 1);
  assert.equal(server.projects.size, 2);
  // The audit UI is addressed per project.
  const url = await projectUiUrl(b.root);
  assert.ok(url.endsWith(`?project=${projectKey(b.root).key}`));
  const status = await (await fetch(`${server.url}/api/status?project=${projectKey(b.root).key}`)).json();
  assert.equal(status.project_id, 'id-2');
  assert.equal((await fetch(`${server.url}/api/status`)).status, 400);
});
