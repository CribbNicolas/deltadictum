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

// Fires by dimension expose the hub shape v2 worried about (prompt keywords);
// the capture funnel says whether asking for memories works at all.
test('fires by dimension, the capture funnel and recent deliveries come with the report', async t => {
  const root = await project(t, [memory('m1', [{ on: ['read'], paths: ['src/a.js'] }, { on: ['prompt'], keywords: ['alpha'] }])], [{ session: 's1' }, { session: 's2' }]);
  const db = openTelemetry(root);
  const fire = db.prepare('INSERT INTO fire_events (memory, session, via, kind, at) VALUES (?, ?, ?, ?, ?)');
  fire.run('m1', 's1', 'keywords', 'prompt', '2026-10-14T10:00:00.000Z');
  fire.run('m1', 's2', 'keywords', 'prompt', '2026-10-14T11:00:00.000Z');
  fire.run('m1', 's2', 'paths', 'read', '2026-10-14T11:00:01.000Z');
  const signal = db.prepare('INSERT INTO signals (session, kind, count) VALUES (?, ?, ?)');
  signal.run('s1', 'asked', 2);
  signal.run('s2', 'correction', 1);
  const inbox = db.prepare('INSERT INTO inbox (at, outcome, reasons, origin, session) VALUES (?, ?, ?, ?, ?)');
  inbox.run('2026-10-14T10:01:00.000Z', 'active', '[]', 'model_initiated', 's1');
  inbox.run('2026-10-14T10:02:00.000Z', 'rejected', '["generic_advice","dead_glob:docs/x.md"]', 'model_initiated', 's1');
  inbox.run('2026-10-14T10:03:00.000Z', 'candidate', '["no_verified_evidence"]', 'user_explicit', 's2');
  db.close();
  const report = await healthReport(root);
  assert.deepEqual(report.memories.find(m => m.id === 'm1').by_dimension, { keywords: 2, paths: 1 });
  assert.deepEqual(report.capture, { asked: 2, corrections: 1, proposals: 3, active: 1, candidates: 1, rejected: 1, requests: 0,
    rejections: { generic_advice: 1, dead_glob: 1 } });
  assert.deepEqual(report.recent.map(f => [f.memory, f.title, f.via, f.kind, f.session, f.at]), [
    ['m1', 'Rule m1', 'paths', 'read', 's2', '2026-10-14T11:00:01.000Z'], ['m1', 'Rule m1', 'keywords', 'prompt', 's2', '2026-10-14T11:00:00.000Z'],
    ['m1', 'Rule m1', 'keywords', 'prompt', 's1', '2026-10-14T10:00:00.000Z']]);
});

test('suspected false alarms and queues come with the report', async t => {
  const root = await project(t, [memory('chk', [{ on: ['edit'], paths: ['src/a.js'] }]),
    memory('mig', [{ on: ['edit'], paths: ['src/a.js'] }], { not_derivable: '', review: { migrated: true, issues: ['not_derivable_missing'] } }),
    // A line drafted through the store is not a person's review: the memory stays queued until one saves it.
    memory('drafted', [{ on: ['edit'], paths: ['src/a.js'] }], { not_derivable: 'Drafted by an agent.', review: { migrated: true, issues: [] } }),
    memory('cand', [{ on: ['edit'], paths: ['src/a.js'] }], { status: 'candidate' }),
    memory('auto', [{ on: ['edit'], paths: ['src/a.js'] }], { review: { migrated: false, issues: [], accepted: { by: 'dd', at: '2026-10-14T00:00:00.000Z' } } })], []);
  mkdirSync(join(root, '.dd', 'local', 'telemetry'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'telemetry', 'checks.jsonl'), `${Array.from({ length: 3 }, () => JSON.stringify({ m: 'chk', path: 'src/a.js', outcome: 'ignored' })).join('\n')}\n`);
  const report = await healthReport(root);
  assert.ok(signalsOf(report, 'chk').includes('suspected_false_alarm'));
  assert.deepEqual(report.queues.candidates, ['cand']);
  assert.deepEqual(report.queues.migrated_without_not_derivable.sort(), ['drafted', 'mig']);
  // What DD accepted on its own stays reviewable: a queue, until a person has seen it.
  assert.deepEqual(report.queues.auto_accepted, ['auto']);
});

test('a trigger over an untracked file is live in health; one over an ignored file is dead', async t => {
  const root = await project(t, [
    memory('draft', [{ on: ['read'], paths: ['doc/draft.md'] }]),
    memory('built', [{ on: ['read'], paths: ['output/**'] }]),
  ], []);
  mkdirSync(join(root, 'doc'));
  mkdirSync(join(root, 'output'));
  writeFileSync(join(root, '.gitignore'), 'output/\n');
  writeFileSync(join(root, 'doc', 'draft.md'), 'new work');
  writeFileSync(join(root, 'output', 'build.exe'), 'x');
  const report = await healthReport(root);
  assert.ok(!signalsOf(report, 'draft').includes('dead_trigger'));
  assert.ok(signalsOf(report, 'built').includes('dead_trigger'));
});
