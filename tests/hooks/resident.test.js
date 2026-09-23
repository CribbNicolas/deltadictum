import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureResident } from '../../src/resident.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { writeUiUrl } from '../../src/hooks/banner.js';
import { residentNotice } from '../../src/hooks/session-start.js';

// These tests decide DD_RESIDENT themselves: an inherited DD_RESIDENT=0 (CI, or
// the agent evaluation harness) would otherwise disable what they exercise.
function residentEnabled(t) {
  const previous = process.env.DD_RESIDENT;
  delete process.env.DD_RESIDENT;
  t.after(() => { if (previous === undefined) delete process.env.DD_RESIDENT; else process.env.DD_RESIDENT = previous; });
}

test('a project with no live resident gets one started; a live one of this build is reused', async t => {
  residentEnabled(t);
  const root = await mkdtemp(join(tmpdir(), 'dd-resident-'));
  await mkdir(join(root, '.dd'));
  const started = [];
  const first = await ensureResident(root, { start: dir => started.push(dir) });
  assert.equal(first.state, 'started');
  assert.deepEqual(started, [root]);

  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await writeUiUrl(join(root, '.dd'), ui);
  const second = await ensureResident(root, { start: dir => started.push(dir) });
  assert.equal(second.state, 'live');
  assert.equal(second.retrieval, 'lexical');
  assert.equal(started.length, 1);
});

test('DD_RESIDENT=0 disables starting one, and says nothing about it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-resident-off-'));
  const previous = process.env.DD_RESIDENT;
  process.env.DD_RESIDENT = '0';
  try {
    const result = await ensureResident(root, { start: () => assert.fail('must not start') });
    assert.equal(result.state, 'disabled');
    assert.equal(residentNotice(result), null);
  } finally { if (previous === undefined) delete process.env.DD_RESIDENT; else process.env.DD_RESIDENT = previous; }
});

test('the first message says when retrieval is lexical and where the fix is', () => {
  assert.match(residentNotice({ state: 'started' }), /lexical for now.*README > "Resident process"/);
  assert.match(residentNotice({ state: 'live', retrieval: 'lexical' }), /optional embedding runtime/);
  assert.equal(residentNotice({ state: 'live', retrieval: 'semantic' }), null);
});

test('a resident whose code changed since it started is replaced, not reused', async t => {
  residentEnabled(t);
  const root = await mkdtemp(join(tmpdir(), 'dd-resident-stale-'));
  await mkdir(join(root, '.dd'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  let code = 'v1';
  const ui = await startUiServer({ store, projectId: 'demo', port: 0, fingerprint: async () => code, staleCheckMs: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await writeUiUrl(join(root, '.dd'), ui);
  const started = [];
  assert.equal((await ensureResident(root, { start: dir => started.push(dir) })).state, 'live');
  code = 'v2';
  const result = await ensureResident(root, { start: dir => started.push(dir) });
  assert.equal(result.state, 'started');
  assert.equal(result.replaced, true);
  assert.equal(started.length, 1);
});
