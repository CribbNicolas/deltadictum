import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { sqlitePath } from './paths.js';

// Local history that exists nowhere else. Atoms, registry and relations come
// back from git on any rebuild; these rows do not.
const HISTORY_TABLES = ['memory_retrieval_events', 'memory_admission_decisions', 'memory_feedback',
  'memory_observations', 'memory_contradiction_log'];

// Every place a DD build has kept this project's index (roadmap gap 6): the
// per-user base, the plugin-host bases, and the in-repo layouts.
export function legacyDataDirs({ repoRoot, names, env = process.env }) {
  const bases = [join(homedir(), '.dd-data'), env.CLAUDE_PLUGIN_DATA, env.GROK_PLUGIN_DATA].filter(Boolean);
  return [...new Set([
    ...bases.flatMap(base => names.map(name => join(base, name))),
    join(repoRoot, '.dd', 'local'), join(repoRoot, '.dd', 'data'),
  ].map(dir => resolve(dir)))];
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

// Copy this project's history rows from earlier indexes into a freshly created
// one. Runs once, when the index is new, so the hot path pays one stat. Rows are
// matched by primary key and filtered by project_id; sources are read, never
// changed or removed. A source that cannot be read is skipped (L5).
export async function adoptHistory(db, { projectId, dataDir, candidates }) {
  const adopted = [];
  for (const dir of candidates) {
    if (resolve(dir) === resolve(dataDir) || !await exists(sqlitePath(dir))) continue;
    let rows = 0;
    try {
      db.prepare('ATTACH DATABASE ? AS legacy').run(sqlitePath(dir));
      try {
        for (const table of HISTORY_TABLES) {
          const theirs = new Set(db.prepare(`PRAGMA legacy.table_info(${table})`).all().map(c => c.name));
          if (!theirs.has('id') || !theirs.has('project_id')) continue;
          const shared = db.prepare(`PRAGMA main.table_info(${table})`).all().map(c => c.name).filter(c => theirs.has(c));
          const columns = shared.join(', ');
          rows += Number(db.prepare(`INSERT OR IGNORE INTO main.${table} (${columns})
            SELECT ${columns} FROM legacy.${table} WHERE project_id = ?`).run(projectId).changes);
        }
      } finally { db.exec('DETACH DATABASE legacy'); }
    } catch { continue; }
    if (rows) adopted.push({ from: dir, rows });
  }
  return adopted;
}
