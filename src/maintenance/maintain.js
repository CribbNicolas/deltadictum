import { markMaintenance } from './due.cjs';
import { openTelemetry, pruneRolled, rollUp } from './telemetry.js';

// One maintenance run (spec section 8): roll session files up, then prune them.
// It runs detached from session start at most once a day, or by hand.
export async function maintain(root, { now = Date.now() } = {}) {
  markMaintenance(root, 'started', { now });
  const db = openTelemetry(root);
  let rolled;
  let pruned;
  try {
    rolled = rollUp(root, db);
    pruned = pruneRolled(root, db, { now });
  } finally { db.close(); }
  markMaintenance(root, 'finished', { now: Date.now() });
  return { rolled, pruned };
}
