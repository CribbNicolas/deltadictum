import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendFootprint, footprintPath } from '../../src/capture/footprint.js';
import { compileProject } from '../../src/engine/compile.js';
import { ledgerPath, openLedger } from '../../src/engine/ledger.cjs';
import { localPaths } from '../../src/engine/locate.cjs';
import { markMaintenance } from '../../src/maintenance/due.cjs';
import { doctorReport } from '../../src/maintenance/doctor.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const CLI = fileURLToPath(new URL('../../src/cli.js', import.meta.url));
const memory = (id, extra = {}) => ({ schema_version: 8, id, project_id: 'p', topic: `doctor/${id}`, kind: 'trap', status: 'active', title: `Rule ${id}`,
  body: `Rule ${id}, always.`, not_derivable: 'Hidden.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [], origin: 'model_initiated',
  replaces: null, revisit_when: [], review: { issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', ...extra });

async function project(t, memories = [memory('m1')]) {
  const root = mkdtempSync(join(tmpdir(), 'dd-doctor-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  await createMemoryFiles(join(root, '.dd')).commit({ put: memories });
  await compileProject(root);
  return root;
}

// Silent failure has no counterweight (L5): a user whose hooks never run sees
// nothing. doctor says what is in place and what is not, in one report.
test('a healthy project reports ok, with its counts and no problem', async t => {
  const root = await project(t);
  openLedger(ledgerPath(localPaths(root).sessions, 's1')).claim(['m1'], { kind: 'edit', viaOf: () => ['paths'] });
  appendFootprint(footprintPath(root, 's1'), { t: 'tool', id: 'e1', at: new Date().toISOString(), kind: 'edit', paths: ['src/a.js'] });
  markMaintenance(root, 'started');
  markMaintenance(root, 'finished');
  const report = await doctorReport(root);
  assert.equal(report.ok, true, JSON.stringify(report.problems));
  assert.deepEqual(report.problems, []);
  assert.equal(report.node.supported, true);
  assert.deepEqual([report.project.opted_in, report.memories.live, report.index.fresh, report.sessions.files, report.maintenance.state], [true, 1, true, 2, 'finished']);
  assert.match(report.summary, /^DD ok: 1 live memor/);
});

test('a project that never opted in is told so, and nothing is created for it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-doctor-bare-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  const report = await doctorReport(root);
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems.map(p => p.code), ['not_opted_in']);
  assert.match(report.problems[0].hint, /deltadictum init/);
  assert.equal(existsSync(join(root, '.dd')), false);
});

test('a stale index, dead triggers, stale evidence and a stuck maintenance run are problems with hints', async t => {
  const root = await project(t, [memory('m1', { triggers: [{ on: ['edit'], paths: ['src/gone.js'] }],
    evidence: [{ type: 'file', path: 'src/a.js', sha256: 'a'.repeat(64), summary: 'changed since' }] })]);
  // Written after the compile: the manifest moved on, the index did not.
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory('m2')] });
  markMaintenance(root, 'started', { now: Date.now() - 3 * 60 * 60 * 1000 });
  const report = await doctorReport(root);
  assert.equal(report.ok, false);
  assert.deepEqual(report.problems.map(p => p.code).sort(), ['dead_triggers', 'index_stale', 'maintenance_stuck', 'stale_evidence']);
  assert.deepEqual([report.signals.dead_triggers, report.signals.stale_evidence], [1, 1]);
  for (const problem of report.problems) assert.ok(problem.hint.length > 20, problem.code);
});

test('no session recorded and a maintenance that never ran are notes, not problems', async t => {
  const root = await project(t);
  const report = await doctorReport(root);
  assert.equal(report.ok, true);
  assert.deepEqual(report.notes.map(n => n.code).sort(), ['maintenance_never_ran', 'no_sessions_recorded']);
  assert.match(report.notes.find(n => n.code === 'no_sessions_recorded').hint, /plugin|node/i);
});

test('deltadictum doctor prints the report and exits 1 on a problem', async t => {
  const root = await project(t);
  const healthy = spawnSync(process.execPath, [CLI, 'doctor'], { cwd: root, encoding: 'utf8' });
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.equal(JSON.parse(healthy.stdout).ok, true);
  const bare = mkdtempSync(join(tmpdir(), 'dd-doctor-cli-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  spawnSync('git', ['-C', bare, 'init', '-q']);
  const out = spawnSync(process.execPath, [CLI, 'doctor'], { cwd: bare, encoding: 'utf8' });
  assert.equal(out.status, 1);
  assert.match(JSON.parse(out.stdout).summary, /not opted in/);
});
