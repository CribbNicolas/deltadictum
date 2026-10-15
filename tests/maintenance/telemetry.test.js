import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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

test('a write waits for another process holding the telemetry lock instead of failing', async t => {
  const root = project();
  const db = open(t, root);
  // Another process (the detached maintenance run) holds a write transaction for a moment.
  const holder = spawn(process.execPath, ['-e', `
    const { DatabaseSync } = require('node:sqlite');
    const other = new DatabaseSync(process.argv.at(-1));
    other.exec('BEGIN IMMEDIATE');
    other.exec("INSERT OR REPLACE INTO meta VALUES ('holder', '1')");
    console.log('locked');
    setTimeout(() => { other.exec('COMMIT'); other.close(); }, 300);
  `, join(root, '.dd', 'local', 'telemetry.sqlite')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise(resolve => holder.once('exit', resolve));
  await new Promise(resolve => holder.stdout.once('data', resolve));
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('ui', '1')").run();
  assert.equal(await exited, 0);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM meta WHERE key IN ('holder', 'ui')"), 2);
});

// Health reads which dimension fired a memory and at which event (claim lines
// carry them), how often Stop asked, corrections and violations, and what the
// inbox did with each proposal.
test('fire dimensions, capture asks, corrections and inbox outcomes are rolled up', t => {
  const root = project();
  writeFileSync(join(sessions(root), 's1.jsonl'), line({ t: 'claim', m: 'm1', n: 0, k: 'a', e: 'read', v: ['paths'], at: '2026-10-14T10:00:00.000Z' })
    + line({ t: 'claim', m: 'm2', n: 0, k: 'b', e: 'prompt', v: ['keywords'], at: '2026-10-14T10:00:01.000Z' }));
  writeFileSync(join(sessions(root), 's1.footprint.jsonl'), line({ t: 'asked', at: 'x', ids: ['f1'] }) + line({ t: 'correction', id: 'c1', at: 'x' })
    + line({ t: 'violation', m: 'm1', path: 'src/a.js', at: 'x' }));
  mkdirSync(join(root, '.dd', 'local', 'telemetry'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'telemetry', 'inbox.jsonl'), line({ at: 'x', outcome: 'active', reasons: [], origin: 'model_initiated', session: 's1' })
    + line({ at: 'y', outcome: 'rejected', reasons: ['generic_advice', 'dead_glob:docs/x.md'], origin: 'model_initiated', session: 's1' }));
  const db = open(t, root);
  rollUp(root, db);
  rollUp(root, db);
  assert.deepEqual(db.prepare('SELECT memory, via, kind, at FROM fire_events ORDER BY at').all().map(r => ({ ...r })),
    [{ memory: 'm1', via: 'paths', kind: 'read', at: '2026-10-14T10:00:00.000Z' }, { memory: 'm2', via: 'keywords', kind: 'prompt', at: '2026-10-14T10:00:01.000Z' }]);
  assert.deepEqual(db.prepare("SELECT kind, count FROM signals WHERE session = 's1' ORDER BY kind").all().map(r => [r.kind, r.count]),
    [['asked', 1], ['correction', 1], ['violation', 1]]);
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM events WHERE session = 's1'"), 0);
  assert.deepEqual(db.prepare('SELECT outcome, reasons FROM inbox ORDER BY at').all().map(r => [r.outcome, JSON.parse(r.reasons)]),
    [['active', []], ['rejected', ['generic_advice', 'dead_glob:docs/x.md']]]);
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

test('delivery records roll up into the deliveries table', t => {
  const root = project();
  writeFileSync(join(sessions(root), 's1.jsonl'), line({ t: 'claim', m: 'm1', n: 0, k: 'a' })
    + line({ t: 'delivery', e: 'read', m: 2, x: 1, c: 9800, n: 0, at: '2026-10-15T10:00:00.000Z' }));
  const db = open(t, root);
  rollUp(root, db);
  assert.deepEqual(db.prepare('SELECT session, at, kind, memories, named, chars FROM deliveries').all().map(row => ({ ...row })),
    [{ session: 's1', at: '2026-10-15T10:00:00.000Z', kind: 'read', memories: 2, named: 1, chars: 9800 }]);
});
