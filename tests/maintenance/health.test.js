import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { healthReport } from '../../src/maintenance/health.js';
import { openTelemetry } from '../../src/maintenance/telemetry.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const memory = (id, triggers, extra = {}) => ({ schema_version: 8, id, project_id: 'p', topic: `health/${id}`, kind: 'trap', status: 'active',
  title: `Rule ${id}`, body: `Rule ${id}.`, not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null,
  revisit_when: [], review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', ...extra });

async function project(t, memories, sessions) {
  const root = mkdtempSync(join(tmpdir(), 'dd-health-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src'));
  for (const name of ['a.js', 'b.js', 'central.js']) writeFileSync(join(root, 'src', name), `export const ${name.replace('.js', '')} = 1;\n`);
  spawnSync('git', ['-C', root, 'add', '-A']);
  await createMemoryFiles(join(root, '.dd')).commit({ put: memories });
  const db = openTelemetry(root);
  for (const { session, touches = [], fires = [] } of sessions) {
    db.prepare('INSERT INTO sessions (session) VALUES (?)').run(session);
    for (const [path, kind] of touches) db.prepare('INSERT OR IGNORE INTO touches VALUES (?, ?, ?)').run(session, path, kind);
    for (const m of fires) db.prepare('INSERT OR IGNORE INTO fires VALUES (?, ?)').run(m, session);
  }
  db.close();
  return root;
}
const signalsOf = (report, id) => report.memories.find(m => m.id === id).signals.map(s => s.signal);

test('each signal of spec section 8 on synthetic telemetry', async t => {
  const sessions = Array.from({ length: 12 }, (_, i) => ({ session: `s${i}`, touches: [['src/a.js', 'edit'], ['src/central.js', 'read']],
    fires: ['hub', ...(i < 2 ? ['wide'] : [])] }));
  const root = await project(t, [
    memory('dead', [{ on: ['edit'], paths: ['docs/none.md'] }]),
    memory('narrow', [{ on: ['edit'], paths: ['src/a.js'], symbols: ['neverWritten'] }]),
    memory('idle', [{ on: ['edit'], paths: ['src/b.js'] }]),
    memory('hub', [{ on: ['edit'], paths: ['src/a.js'] }]),
    memory('wide', [{ on: ['read'], paths: ['src/central.js'] }]),
    memory('stale', [{ on: ['edit'], paths: ['src/b.js'] }], { evidence: [{ type: 'file', path: 'src/b.js', sha256: createHash('sha256').update('old').digest('hex'), summary: 's' }] }),
  ], sessions);
  const report = await healthReport(root);
  assert.equal(report.sessions, 12);
  assert.ok(signalsOf(report, 'dead').includes('dead_trigger'));
  assert.ok(signalsOf(report, 'narrow').includes('never_fired_with_opportunity'));
  assert.ok(signalsOf(report, 'idle').includes('no_opportunity'));
  assert.ok(signalsOf(report, 'hub').includes('hub'));
  assert.ok(signalsOf(report, 'wide').includes('path_only_central'));
  assert.ok(signalsOf(report, 'stale').includes('stale_evidence'));
  assert.deepEqual(signalsOf(report, 'hub').filter(s => s === 'never_fired_with_opportunity'), []);
});

test('suspected false alarms and queues come with the report', async t => {
  const root = await project(t, [memory('chk', [{ on: ['edit'], paths: ['src/a.js'] }]),
    memory('mig', [{ on: ['edit'], paths: ['src/a.js'] }], { not_derivable: '', review: { migrated: true, issues: ['not_derivable_missing'] } }),
    memory('cand', [{ on: ['edit'], paths: ['src/a.js'] }], { status: 'candidate' })], []);
  mkdirSync(join(root, '.dd', 'local', 'telemetry'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'telemetry', 'checks.jsonl'), `${Array.from({ length: 3 }, () => JSON.stringify({ m: 'chk', path: 'src/a.js', outcome: 'ignored' })).join('\n')}\n`);
  const report = await healthReport(root);
  assert.ok(signalsOf(report, 'chk').includes('suspected_false_alarm'));
  assert.deepEqual(report.queues.candidates, ['cand']);
  assert.deepEqual(report.queues.migrated_without_not_derivable, ['mig']);
});
