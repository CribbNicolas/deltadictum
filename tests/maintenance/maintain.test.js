import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { maintenanceDue, markMaintenance } from '../../src/maintenance/due.cjs';
import { maintain } from '../../src/maintenance/maintain.js';
import { createMemoryFiles } from '../../src/memory/store.js';

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-maintain-'));
  // The detached maintenance process keeps the project as its working directory and exits a moment
  // after it writes "finished": Windows refuses to remove the folder until then, so the removal retries.
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 60, retryDelay: 250 }));
  mkdirSync(join(root, '.git'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [] });
  return root;
}

test('maintenance is due without a record, or a day after the last run started', async t => {
  const root = await project(t);
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  assert.equal(maintenanceDue(root, { now }), true);
  markMaintenance(root, 'started', { now });
  assert.equal(maintenanceDue(root, { now: now + 60 * 60 * 1000 }), false);
  // A run that started and failed does not spawn again at every session start.
  assert.equal(maintenanceDue(root, { now: now + 23 * 60 * 60 * 1000 }), false);
  assert.equal(maintenanceDue(root, { now: now + 25 * 60 * 60 * 1000 }), true);
});

test('a maintenance run rolls up and records when it ran', async t => {
  const root = await project(t);
  mkdirSync(join(root, '.dd', 'local', 'sessions'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'sessions', 's1.jsonl'), `${JSON.stringify({ t: 'claim', m: 'm1', n: 0, k: 'a' })}\n`);
  const result = await maintain(root);
  assert.deepEqual(result.rolled, { files: 1, lines: 1 });
  assert.deepEqual(result.similarity, { rebuilt: true });
  assert.deepEqual((await maintain(root)).similarity, { rebuilt: false });
  assert.equal(JSON.parse(readFileSync(join(root, '.dd', 'local', 'maintenance.json'), 'utf8')).state, 'finished');
});

test('session start starts maintenance in the background when it is due, and says nothing', async t => {
  const root = await project(t);
  const run = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
  const out = spawnSync(process.execPath, [run, 'session-start'], { input: JSON.stringify({ session_id: 's', cwd: root, source: 'startup' }), encoding: 'utf8', env: { ...process.env, DD_MAINTENANCE: '1' } });
  assert.equal(out.stdout, '');
  const marker = join(root, '.dd', 'local', 'maintenance.json');
  const finished = () => { try { return JSON.parse(readFileSync(marker, 'utf8')).state === 'finished'; } catch { return false; } };
  for (let i = 0; i < 150 && !finished(); i += 1) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(existsSync(marker) && finished(), 'maintenance never ran');
});

test('DD_MAINTENANCE=0 keeps session start from starting maintenance', async t => {
  const root = await project(t);
  const run = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
  spawnSync(process.execPath, [run, 'session-start'], { input: JSON.stringify({ session_id: 's', cwd: root, source: 'startup' }), encoding: 'utf8',
    env: { ...process.env, DD_MAINTENANCE: '0' } });
  await new Promise(resolve => setTimeout(resolve, 1500));
  assert.equal(existsSync(join(root, '.dd', 'local', 'maintenance.json')), false);
});
