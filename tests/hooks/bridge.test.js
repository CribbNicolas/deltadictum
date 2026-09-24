import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callRunningStore } from '../../src/hooks/bridge.js';
import { BUILD_ID } from '../../src/hooks/build.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { registerResident } from '../helpers/resident.js';

async function startSlowUi(delayMs) {
  const server = createServer((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'content-type': 'application/json', 'x-dd-build': BUILD_ID });
      res.end(JSON.stringify({ ok: true }));
    }, delayMs);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return server;
}

describe('bridging to a running audit UI', () => {
  test('pre-tool times out against a slow local UI well before session-start does', async t => {
    const delayMs = 400;
    const server = await startSlowUi(delayMs);
    t.after(() => server.close());
    const { port } = server.address();

    const repoRoot = await mkdtemp(join(tmpdir(), 'dd-bridge-'));
    await registerResident(t, { url: `http://127.0.0.1:${port}`, port, hookToken: 'a'.repeat(64) });

    // pre-tool's timeout (250ms) is shorter than the server's delay: it must give
    // up and fall back to null, not stall the hottest path in the system.
    const preTool = await callRunningStore('pre-tool', {}, repoRoot);
    assert.equal(preTool, null);

    // session-start's timeout (1500ms) tolerates the same delay: it fires far less
    // often, so it can afford to wait for a real answer instead of falling back.
    const sessionStart = await callRunningStore('session-start', {}, repoRoot);
    assert.deepEqual(sessionStart, { ok: true });
  });
});

// Gap 7: a hook must not take its answer from an audit UI running other code.
describe('bridging only to the same build', () => {
  const uiJson = (t, port) => registerResident(t, { url: `http://127.0.0.1:${port}`, port, hookToken: 'a'.repeat(64) });
  async function fakeUi(headers) {
    const server = createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end('{"ok":true}'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
  }

  test('a reply without this build id is ignored, so the hook runs locally', async t => {
    const other = await fakeUi({ 'x-dd-build': 'f'.repeat(16) });
    const unversioned = await fakeUi({});
    const same = await fakeUi({ 'x-dd-build': BUILD_ID });
    t.after(() => { other.close(); unversioned.close(); same.close(); });
    for (const [server, expected] of [[other, null], [unversioned, null], [same, { ok: true }]]) {
      const repoRoot = await mkdtemp(join(tmpdir(), 'dd-build-'));
      await uiJson(t, server.address().port);
      assert.deepEqual(await callRunningStore('session-start', {}, repoRoot), expected);
    }
  });

  test('the audit UI refuses hook calls once its own code has changed', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-stale-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
    let code = 'v1';
    const ui = await startUiServer({ store, projectId: 'demo', port: 0, fingerprint: async () => code, staleCheckMs: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    await registerResident(t, ui);
    assert.notEqual(await callRunningStore('session-start', { session_id: 's' }, root), null);
    code = 'v2';
    assert.equal(await callRunningStore('session-start', { session_id: 's' }, root), null);
  });
});

describe('bridging across installs of one version', () => {
  test('a reply from another tree of the same version is taken; another version is not', async t => {
    const { VERSION } = await import('../../src/hooks/build.js');
    const reply = headers => createServer((req, res) => { res.writeHead(200, { 'content-type': 'application/json', ...headers }); res.end('{"ok":true}'); });
    const cases = [[{ 'x-dd-build': 'f'.repeat(16), 'x-dd-version': VERSION }, { ok: true }],
      [{ 'x-dd-build': 'f'.repeat(16), 'x-dd-version': '0.0.1' }, null]];
    for (const [headers, expected] of cases) {
      const server = reply(headers);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      t.after(() => server.close());
      const { port } = server.address();
      await registerResident(t, { url: `http://127.0.0.1:${port}`, port, hookToken: 'a'.repeat(64) });
      assert.deepEqual(await callRunningStore('session-start', {}, await mkdtemp(join(tmpdir(), 'dd-version-'))), expected);
    }
  });
});
