import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { recall, status } from '../../src/maintenance/recall.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const memory = (id, title, body, state = 'active') => ({ schema_version: 8, id, project_id: 'p', topic: `recall/${id}`, kind: 'trap', status: state,
  title, body, not_derivable: 'Hidden.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [], origin: 'model_initiated', replaces: null,
  revisit_when: [], review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z' });

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-recall-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [
    memory('close', 'Close stores in t.after', 'Close every store a test opens in t.after.'),
    memory('draft', 'Close sockets in t.after', 'Close sockets too.', 'candidate'),
  ] });
  return root;
}

test('recall prints the matching live memories in full; candidates only with --all', async t => {
  const root = await project(t);
  const text = await recall(root, 'store t.after');
  assert.match(text, /^\[TRAP\] Close stores in t\.after \(recall\/close, active\)\nClose every store a test opens in t\.after\./);
  assert.doesNotMatch(text, /sockets/);
  assert.match(await recall(root, 'close sockets', { all: true }), /Close sockets in t\.after \(recall\/draft, candidate\)/);
  assert.equal(await recall(root, '"*:-'), 'DD - nothing matches.');
});

test('status counts memories by status', async t => {
  const root = await project(t);
  assert.deepEqual(await status(root), { total: 2, by_status: { active: 1, candidate: 1 }, candidates: 1, conflicts: [] });
});

test('deltadictum recall runs from the project', async t => {
  const root = await project(t);
  const cli = fileURLToPath(new URL('../../src/cli.js', import.meta.url));
  const out = spawnSync(process.execPath, [cli, 'recall', 'store', 't.after'], { cwd: root, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /Close stores in t\.after/);
  const counts = spawnSync(process.execPath, [cli, 'status'], { cwd: root, encoding: 'utf8' });
  assert.equal(counts.status, 0, counts.stderr);
  assert.equal(JSON.parse(counts.stdout).total, 2);
});
