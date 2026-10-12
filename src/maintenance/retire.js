import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localPaths } from '../engine/locate.cjs';
import { createMemoryFiles } from '../memory/store.js';
import { opportunity } from './health.js';
import { openTelemetry } from './telemetry.js';

// Retirement by disuse (spec section 8): an active memory whose paths were
// touched in at least N sessions (default 20) without it ever firing is archived.
// A memory a person reviewed is never retired automatically; `origin` is not
// proof of a person (the agent writes it). Archiving keeps the file in git.
function afterSessionsOf(root) {
  try { return JSON.parse(readFileSync(join(localPaths(root).dd, 'config.json'), 'utf8')).retire?.after_sessions ?? 20; } catch { return 20; }
}

export async function retireByDisuse(root, { afterSessions = afterSessionsOf(root), now = new Date() } = {}) {
  const store = createMemoryFiles(localPaths(root).dd);
  const active = (await store.list()).filter(memory => memory.status === 'active' && memory.review?.accepted?.by !== 'person');
  if (!active.length) return [];
  const db = openTelemetry(root);
  let retired;
  try {
    const touches = db.prepare('SELECT session, path FROM touches').all();
    retired = active.filter(memory => {
      const { measured, sessions, fired } = opportunity(db, memory, touches);
      return measured && sessions.size >= afterSessions && fired.size === 0;
    });
  } finally { db.close(); }
  if (!retired.length) return [];
  await store.commit({ put: retired.map(memory => ({ ...memory, status: 'archived', updated: now.toISOString(),
    review: { ...memory.review, issues: [...new Set([...(memory.review?.issues ?? []), 'retired_by_disuse'])] } })) });
  return retired.map(memory => memory.id);
}
