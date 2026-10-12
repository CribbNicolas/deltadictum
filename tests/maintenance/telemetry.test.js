import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTelemetry, pruneRolled, rollUp } from '../../src/maintenance/telemetry.js';

function project() {
  const root = mkdtempSync(join(tmpdir(), 'dd-telemetry-'));
  mkdirSync(join(root, '.dd', 'local', 'sessions'), { recursive: true });
  return root;
}
// Windows keeps an open SQLite file: close it before the folder goes.
function open(t, root) {
  const db = openTelemetry(root);
  t.after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  return db;
}
const sessions = root => join(root, '.dd', 'local', 'sessions');
const line = value => `${JSON.stringify(value)}\n`;
const count = (db, sql) => db.prepare(sql).get().n;

test('ledgers become fires and footprints become touches and events, once', t => {
  const root = project();
  writeFileSync(join(sessions(root), 's1.jsonl'), line({ t: 'claim', m: 'm1', n: 0, k: 'a' }) + line({ t: 'claim', m: 'm1', n: 0, k: 'b' }));
  writeFileSync(join(sessions(root), 's1.agentx.jsonl'), line({ t: 'claim', m: 'm2', n: 0, k: 'c' }));
  writeFileSync(join(sessions(root), 's1.footprint.jsonl'), line({ t: 'tool', at: '2026-10-12T00:00:00.000Z', kind: 'read', paths: ['src/a.js'] })
    + line({ t: 'tool', at: '2026-10-12T00:00:01.000Z', kind: 'edit', paths: ['src/a.js'] }) + line({ t: 'asked', ids: [] }));
  const db = open(t, root);
  rollUp(root, db);
  rollUp(root, db);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM fires'), 2);
  assert.deepEqual(db.prepare('SELECT session, path, kind FROM touches ORDER BY kind').all().map(r => ({ ...r })),
    [{ session: 's1', path: 'src/a.js', kind: 'edit' }, { session: 's1', path: 'src/a.js', kind: 'read' }]);
  assert.equal(count(db, "SELECT SUM(count) AS n FROM events WHERE session = 's1'"), 2);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM sessions'), 1);
});

test('a torn last line waits for the next roll-up; nothing is counted twice', t => {
  const root = project();
  const file = join(sessions(root), 's2.footprint.jsonl');
  writeFileSync(file, line({ t: 'tool', at: 'x', kind: 'read', paths: ['a.js'] }) + '{"t":"tool","at":"y","kind":"read","pa');
  const db = open(t, root);
  rollUp(root, db);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM touches'), 1);
  appendFileSync(file, 'ths":["b.js"]}\n');
  rollUp(root, db);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM touches'), 2);
});

test('only rolled-up session files older than the limit are deleted', t => {
  const root = project();
  const old = join(sessions(root), 'old.jsonl');
  const pending = join(sessions(root), 'pending.jsonl');
  writeFileSync(old, line({ t: 'claim', m: 'm1', n: 0, k: 'a' }));
  const db = open(t, root);
  rollUp(root, db);
  writeFileSync(pending, line({ t: 'claim', m: 'm2', n: 0, k: 'b' }));
  const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(old, past, past);
  utimesSync(pending, past, past);
  assert.equal(pruneRolled(root, db), 1);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(pending), true);
});

test('check telemetry is rolled up too', t => {
  const root = project();
  mkdirSync(join(root, '.dd', 'local', 'telemetry'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'telemetry', 'checks.jsonl'), line({ m: 'm1', path: 'src/a.js', outcome: 'ignored', at: 'x' }));
  const db = open(t, root);
  rollUp(root, db);
  rollUp(root, db);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM checks WHERE outcome = 'ignored'"), 1);
});
