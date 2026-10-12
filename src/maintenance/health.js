import { createRequire } from 'node:module';
import { suspectedFalseAlarms } from '../checks/turn.js';
import { globToRegExp } from '../engine/clause.cjs';
import { codeSymbols, repoFilesOf, triggerWarnings } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { LIVE_STATUSES } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';
import { openTelemetry, rollUp } from './telemetry.js';

const { staleEvidence } = createRequire(import.meta.url)('../engine/deliver.cjs');

// Sessions that touched a file a memory's path clauses cover (its opportunity),
// and sessions it fired in. A memory without path clauses has no measured
// opportunity: keywords and symbols leave no footprint to compare against.
export function opportunity(db, memory, touches = db.prepare('SELECT session, path FROM touches').all()) {
  const globs = memory.triggers.flatMap(clause => clause.paths ?? []).map(glob => globToRegExp(glob));
  const sessions = new Set(globs.length ? touches.filter(row => globs.some(regex => regex.test(row.path))).map(row => row.session) : []);
  const fired = new Set(db.prepare('SELECT session FROM fires WHERE memory = ?').all(memory.id).map(row => row.session));
  return { measured: globs.length > 0, sessions, fired };
}

// The health of a project's memories (spec section 8): each live memory with its
// signals, and the queues a person reviews.
export async function healthReport(root, { minOpportunity = 10, hubShare = 0.3, centralShare = 0.3, minSessions = 10 } = {}) {
  const store = createMemoryFiles(localPaths(root).dd);
  const all = await store.list();
  const live = all.filter(memory => LIVE_STATUSES.includes(memory.status));
  const db = openTelemetry(root);
  try {
    rollUp(root, db);
    const sessions = db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    const touches = db.prepare('SELECT session, path FROM touches').all();
    const repoFiles = repoFilesOf(root);
    const found = repoFiles ? codeSymbols(root, [...new Set(live.flatMap(m => m.triggers.flatMap(c => c.symbols ?? [])))]) : null;
    const alarms = new Set(suspectedFalseAlarms(root).map(alarm => alarm.memory));
    const memories = live.map(memory => {
      const signals = [];
      for (const warning of triggerWarnings(memory, repoFiles, found ? symbol => found.has(symbol) : null)) {
        if (warning.kind.startsWith('dead_')) signals.push({ signal: 'dead_trigger', value: warning.value });
      }
      const { measured, sessions: chances, fired } = opportunity(db, memory, touches);
      if (measured && !chances.size) signals.push({ signal: 'no_opportunity' });
      if (measured && chances.size >= minOpportunity && !fired.size) signals.push({ signal: 'never_fired_with_opportunity', value: chances.size });
      if (sessions >= minSessions && fired.size / sessions > hubShare) signals.push({ signal: 'hub', value: Math.round((fired.size / sessions) * 100) });
      for (const clause of memory.triggers) {
        const pathOnly = clause.paths?.length && !clause.symbols?.length && !clause.commands?.length && !clause.keywords?.length;
        if (!pathOnly || sessions < minSessions) continue;
        const globs = clause.paths.map(glob => globToRegExp(glob));
        const share = new Set(touches.filter(row => globs.some(regex => regex.test(row.path))).map(row => row.session)).size / sessions;
        if (share > centralShare) { signals.push({ signal: 'path_only_central', value: clause.paths.join(', ') }); break; }
      }
      if (alarms.has(memory.id)) signals.push({ signal: 'suspected_false_alarm' });
      const stale = staleEvidence(root, memory.evidence.filter(entry => entry.type === 'file' && entry.sha256));
      if (stale.length) signals.push({ signal: 'stale_evidence', value: stale.join(', ') });
      return { id: memory.id, topic: memory.topic, title: memory.title, status: memory.status, signals, fired: fired.size, opportunity: chances.size };
    });
    return {
      sessions, memories, conflicts: await store.conflicts(), unsupported: await store.unsupported(),
      queues: {
        candidates: all.filter(memory => memory.status === 'candidate').map(memory => memory.id),
        migrated_without_not_derivable: live.filter(memory => memory.review?.migrated && !String(memory.not_derivable ?? '').trim()).map(memory => memory.id),
      },
    };
  } finally { db.close(); }
}
