import { localPaths } from '../engine/locate.cjs';
import { LIVE_STATUSES } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';
import { refreshSimilarity, similarTo } from './similar.js';
import { openTelemetry } from './telemetry.js';

const LABELS = { trap: 'TRAP', decision: 'DECISION', fact: 'FACT', failed_approach: 'ABANDONED', procedure: 'PROCEDURE' };

// `deltadictum recall` (spec section 8): an explicit lookup, lexical, printed in
// full. It never decides what hooks deliver.
export async function recall(root, query, { all = false, limit = 5 } = {}) {
  const store = createMemoryFiles(localPaths(root).dd);
  const every = await store.list();
  const memories = every.filter(memory => (all ? memory.status !== 'archived' : LIVE_STATUSES.includes(memory.status)));
  const db = openTelemetry(root);
  let hits;
  try {
    refreshSimilarity(root, db, every.filter(memory => memory.status !== 'archived'), (await store.manifest())?.hash ?? '');
    hits = similarTo(db, query, { limit: limit * 4 });
  } finally { db.close(); }
  const byId = new Map(memories.map(memory => [memory.id, memory]));
  const found = hits.map(hit => byId.get(hit.id)).filter(Boolean).slice(0, limit);
  if (!found.length) return 'DD - nothing matches.';
  return found.map(memory => `[${LABELS[memory.kind] ?? 'NOTE'}] ${memory.title} (${memory.topic}, ${memory.status})\n${memory.body}\nTriggers: ${JSON.stringify(memory.triggers)}`).join('\n\n');
}

export async function status(root) {
  const store = createMemoryFiles(localPaths(root).dd);
  const memories = await store.list();
  const byStatus = {};
  for (const memory of memories) byStatus[memory.status] = (byStatus[memory.status] ?? 0) + 1;
  return { total: memories.length, by_status: byStatus, candidates: byStatus.candidate ?? 0, conflicts: await store.conflicts() };
}
