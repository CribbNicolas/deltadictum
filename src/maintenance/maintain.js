import { compileProject } from '../engine/compile.js';
import { markMaintenance } from './due.cjs';
import { retireByDisuse } from './retire.js';
import { openTelemetry, pruneRolled, rollUp } from './telemetry.js';

// One maintenance run (spec section 8): roll session files up, prune them, retire
// memories that never fire despite opportunity. It runs detached from session
// start at most once a day, or by hand.
export async function maintain(root, { now = Date.now() } = {}) {
  markMaintenance(root, 'started', { now });
  const db = openTelemetry(root);
  let rolled;
  let pruned;
  try {
    rolled = rollUp(root, db);
    pruned = pruneRolled(root, db, { now });
  } finally { db.close(); }
  const retired = await retireByDisuse(root);
  if (retired.length) await compileProject(root);
  markMaintenance(root, 'finished', { now: Date.now() });
  return { rolled, pruned, retired };
}
