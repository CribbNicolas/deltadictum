import { closeSync, fstatSync, mkdirSync, openSync, readdirSync, readSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { localPaths } from '../engine/locate.cjs';

// Session files are DD's raw telemetry (spec section 8). They roll up into
// counters here, by byte offset: a roll-up reads only what was appended since the
// last one, and only whole lines, so it is idempotent and a torn line waits.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS rolled (file TEXT PRIMARY KEY, offset INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (session TEXT PRIMARY KEY, first_at TEXT, last_at TEXT);
CREATE TABLE IF NOT EXISTS fires (memory TEXT NOT NULL, session TEXT NOT NULL, PRIMARY KEY (memory, session));
CREATE TABLE IF NOT EXISTS touches (session TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL, PRIMARY KEY (session, path, kind));
CREATE TABLE IF NOT EXISTS events (session TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (session, kind));
CREATE TABLE IF NOT EXISTS checks (memory TEXT NOT NULL, path TEXT, outcome TEXT NOT NULL, at TEXT);
CREATE TABLE IF NOT EXISTS fire_events (memory TEXT NOT NULL, session TEXT NOT NULL, via TEXT, kind TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS signals (session TEXT NOT NULL, kind TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (session, kind));
CREATE TABLE IF NOT EXISTS inbox (at TEXT, outcome TEXT NOT NULL, reasons TEXT, origin TEXT, session TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS deliveries (session TEXT NOT NULL, at TEXT, kind TEXT, memories INTEGER NOT NULL, named INTEGER NOT NULL, chars INTEGER NOT NULL);
`;
const CHECKS_KEY = 'telemetry/checks.jsonl';
const INBOX_KEY = 'telemetry/inbox.jsonl';
// Footprint lines that are not tool calls but capture signals: how often Stop
// asked for a memory, corrections recorded, violations reported.
const SIGNALS = new Set(['asked', 'correction', 'violation']);

export function openTelemetry(root) {
  const local = localPaths(root).local;
  mkdirSync(local, { recursive: true });
  const db = new DatabaseSync(join(local, 'telemetry.sqlite'));
  // The detached maintenance run, the review UI and the CLI open it from different
  // processes: a writer waits out another's short transaction instead of failing.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

// The whole lines appended since `offset`, and the offset after the last of them.
function appended(path, offset) {
  let fd;
  try { fd = openSync(path, 'r'); } catch { return { lines: [], end: offset }; }
  try {
    const size = fstatSync(fd).size;
    if (size <= offset) return { lines: [], end: Math.min(offset, size) };
    const buffer = Buffer.alloc(size - offset);
    readSync(fd, buffer, 0, buffer.length, offset);
    const last = buffer.lastIndexOf(0x0a);
    if (last < 0) return { lines: [], end: offset };
    const lines = buffer.subarray(0, last).toString('utf8').split('\n').filter(Boolean)
      .map(text => { try { return JSON.parse(text); } catch { return null; } }).filter(Boolean);
    return { lines, end: offset + last + 1 };
  } finally { closeSync(fd); }
}

// '<session>.jsonl', '<session>.<agent>.jsonl' and '<session>.footprint.jsonl':
// ledgerPath writes ids with dots replaced, so the first segment is the session.
const sessionOf = name => name.split('.')[0];

function sessionFiles(root) {
  try { return readdirSync(localPaths(root).sessions).filter(name => name.endsWith('.jsonl')); } catch { return []; }
}

export function rollUp(root, db) {
  const dir = localPaths(root).sessions;
  const offsetOf = db.prepare('SELECT offset FROM rolled WHERE file = ?');
  const setOffset = db.prepare('INSERT INTO rolled (file, offset) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET offset = excluded.offset');
  const fire = db.prepare('INSERT OR IGNORE INTO fires (memory, session) VALUES (?, ?)');
  const touch = db.prepare('INSERT OR IGNORE INTO touches (session, path, kind) VALUES (?, ?, ?)');
  const event = db.prepare('INSERT INTO events (session, kind, count) VALUES (?, ?, 1) ON CONFLICT(session, kind) DO UPDATE SET count = count + 1');
  const seen = db.prepare(`INSERT INTO sessions (session, first_at, last_at) VALUES (?, ?, ?) ON CONFLICT(session) DO UPDATE SET
    first_at = COALESCE(MIN(first_at, excluded.first_at), first_at, excluded.first_at),
    last_at = COALESCE(MAX(last_at, excluded.last_at), last_at, excluded.last_at)`);
  const check = db.prepare('INSERT INTO checks (memory, path, outcome, at) VALUES (?, ?, ?, ?)');
  const fireEvent = db.prepare('INSERT INTO fire_events (memory, session, via, kind, at) VALUES (?, ?, ?, ?, ?)');
  const signal = db.prepare('INSERT INTO signals (session, kind, count) VALUES (?, ?, 1) ON CONFLICT(session, kind) DO UPDATE SET count = count + 1');
  const inbox = db.prepare('INSERT INTO inbox (at, outcome, reasons, origin, session) VALUES (?, ?, ?, ?, ?)');
  const delivery = db.prepare('INSERT INTO deliveries (session, at, kind, memories, named, chars) VALUES (?, ?, ?, ?, ?, ?)');
  let files = 0;
  let lines = 0;
  db.exec('BEGIN');
  try {
    for (const name of sessionFiles(root)) {
      const { lines: found, end } = appended(join(dir, name), offsetOf.get(name)?.offset ?? 0);
      if (!found.length) continue;
      const session = sessionOf(name);
      const footprint = name.endsWith('.footprint.jsonl');
      seen.run(session, null, null);
      for (const entry of found) {
        if (footprint) {
          if (SIGNALS.has(entry.t)) { signal.run(session, entry.t); continue; }
          if (entry.t !== 'tool') continue;
          for (const path of entry.paths ?? []) touch.run(session, String(path), String(entry.kind));
          event.run(session, String(entry.kind));
          if (entry.at) seen.run(session, String(entry.at), String(entry.at));
        } else if (entry.t === 'delivery') {
          delivery.run(session, entry.at === undefined ? null : String(entry.at), entry.e === undefined ? null : String(entry.e),
            Number(entry.m) || 0, Number(entry.x) || 0, Number(entry.c) || 0);
        } else if (entry.t === 'claim' && entry.m) {
          fire.run(String(entry.m), session);
          // Claims written since the dimension was recorded say what fired and when.
          if (entry.v !== undefined || entry.e !== undefined) {
            fireEvent.run(String(entry.m), session, Array.isArray(entry.v) ? entry.v.map(String).join('+') : String(entry.v ?? ''),
              entry.e === undefined ? null : String(entry.e), entry.at === undefined ? null : String(entry.at));
          }
        }
      }
      setOffset.run(name, end);
      files += 1;
      lines += found.length;
    }
    const telemetry = join(localPaths(root).local, 'telemetry');
    const { lines: reported, end } = appended(join(telemetry, 'checks.jsonl'), offsetOf.get(CHECKS_KEY)?.offset ?? 0);
    for (const entry of reported) check.run(String(entry.m), entry.path ?? null, String(entry.outcome), entry.at ?? null);
    if (reported.length) setOffset.run(CHECKS_KEY, end);
    const ingested = appended(join(telemetry, 'inbox.jsonl'), offsetOf.get(INBOX_KEY)?.offset ?? 0);
    for (const entry of ingested.lines) {
      inbox.run(entry.at ?? null, String(entry.outcome), JSON.stringify(Array.isArray(entry.reasons) ? entry.reasons.map(String) : []), entry.origin ?? null, entry.session ?? null);
    }
    if (ingested.lines.length) setOffset.run(INBOX_KEY, ingested.end);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { files, lines };
}

// Files older than the limit go once everything in them was rolled up.
export function pruneRolled(root, db, { maxAgeMs = 7 * 24 * 60 * 60 * 1000, now = Date.now() } = {}) {
  const dir = localPaths(root).sessions;
  const offsetOf = db.prepare('SELECT offset FROM rolled WHERE file = ?');
  const forget = db.prepare('DELETE FROM rolled WHERE file = ?');
  let pruned = 0;
  for (const name of sessionFiles(root)) {
    try {
      const info = statSync(join(dir, name));
      if (now - info.mtimeMs <= maxAgeMs || (offsetOf.get(name)?.offset ?? -1) !== info.size) continue;
      rmSync(join(dir, name), { force: true });
      forget.run(name);
      pruned += 1;
    } catch { /* locked or gone: the next run */ }
  }
  return pruned;
}
