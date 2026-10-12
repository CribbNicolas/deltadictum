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
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;
const CHECKS_KEY = 'telemetry/checks.jsonl';

export function openTelemetry(root) {
  const local = localPaths(root).local;
  mkdirSync(local, { recursive: true });
  const db = new DatabaseSync(join(local, 'telemetry.sqlite'));
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
          if (entry.t !== 'tool') continue;
          for (const path of entry.paths ?? []) touch.run(session, String(path), String(entry.kind));
          event.run(session, String(entry.kind));
          if (entry.at) seen.run(session, String(entry.at), String(entry.at));
        } else if (entry.t === 'claim' && entry.m) fire.run(String(entry.m), session);
      }
      setOffset.run(name, end);
      files += 1;
      lines += found.length;
    }
    const { lines: reported, end } = appended(join(localPaths(root).local, 'telemetry', 'checks.jsonl'), offsetOf.get(CHECKS_KEY)?.offset ?? 0);
    for (const entry of reported) check.run(String(entry.m), entry.path ?? null, String(entry.outcome), entry.at ?? null);
    if (reported.length) setOffset.run(CHECKS_KEY, end);
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
