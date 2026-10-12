import { compileProject } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { createMemoryFiles } from '../memory/store.js';
import { markMaintenance } from './due.cjs';
import { retireByDisuse } from './retire.js';
import { refreshSimilarity } from './similar.js';
import { openTelemetry, pruneRolled, rollUp } from './telemetry.js';

// One maintenance run (spec section 8): roll session files up, prune them, retire
// memories that never fire despite opportunity, and refresh the similarity index.
// It runs detached from session start at most once a day, or by hand.
export async function maintain(root, { now = Date.now() } = {}) {
  markMaintenance(root, 'started', { now });
  let db = openTelemetry(root);
  let rolled;
  let pruned;
  try {
    rolled = rollUp(root, db);
    pruned = pruneRolled(root, db, { now });
  } finally { db.close(); }
  const retired = await retireByDisuse(root);
  if (retired.length) await compileProject(root);
  const store = createMemoryFiles(localPaths(root).dd);
  const memories = (await store.list()).filter(memory => memory.status !== 'archived');
  db = openTelemetry(root);
  let rebuilt;
  try { rebuilt = refreshSimilarity(root, db, memories, (await store.manifest())?.hash ?? ''); } finally { db.close(); }
  markMaintenance(root, 'finished', { now: Date.now() });
  return { rolled, pruned, retired, similarity: { rebuilt } };
}
