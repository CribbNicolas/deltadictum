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
export const AFTER_SESSIONS = { default: 20, min: 1, max: 1000 };
export const validAfterSessions = value => Number.isInteger(value) && value >= AFTER_SESSIONS.min && value <= AFTER_SESSIONS.max;

// retire.after_sessions in .dd/config.json; a value out of bounds counts as unset.
export function afterSessionsOf(root) {
  let value;
  try { value = JSON.parse(readFileSync(join(localPaths(root).dd, 'config.json'), 'utf8')).retire?.after_sessions; } catch { /* no config */ }
  return validAfterSessions(value) ? value : AFTER_SESSIONS.default;
}

export async function retireByDisuse(root, { afterSessions = afterSessionsOf(root), now = new Date() } = {}) {
  const store = createMemoryFiles(localPaths(root).dd);
  const all = await store.list();
  // A revision waiting for review must still find its target.
  const revised = new Set(all.filter(memory => memory.status === 'candidate' && memory.replaces).map(memory => memory.replaces));
  const active = all.filter(memory => memory.status === 'active' && memory.review?.accepted?.by !== 'person' && !revised.has(memory.id));
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
