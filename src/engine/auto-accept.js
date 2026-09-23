import { admitMemory, HUMAN_REVIEW } from './lifecycle.js';
import { verifyReferences } from './evidence.js';
import { cappedConfidence } from './reliability.js';

export async function sweepAutoAccept({ store, projectId }) {
  const config = await store.loadConfig();
  if (!config.auto_accept?.enabled) return { admitted: [] };
  const threshold = config.auto_accept.confidence_threshold;
  // One candidate per topic: the newest draft. Admitting several in list order
  // let an older draft supersede a newer one on the same topic_key; the older
  // drafts stay candidates for a person to reject.
  const newest = new Map();
  for (const atom of await store.listAtoms({ projectId, lifecycleStates: ['candidate'] })) {
    const current = newest.get(atom.topic_key);
    if (!current || String(atom.created_at) > String(current.created_at)) newest.set(atom.topic_key, atom);
  }
  const candidates = [...newest.values()];
  const admitted = [];
  for (const candidate of candidates) {
    // candidate.confidence (stamped at proposal time) is not usable here -- it's
    // a constant, since evidence isn't verified until review. Compute the real,
    // evidence-based projection ourselves: the same two calls admitMemory makes
    // internally to produce the number it actually stamps.
    const evidence_state = await verifyReferences(candidate.evidence_refs, { store, projectId });
    const projectedConfidence = cappedConfidence({ ...candidate, evidence_state }, { authority: 'validated' });
    if (projectedConfidence < threshold) continue;
    try {
      await admitMemory(candidate.id, {
        store, projectId, actor: HUMAN_REVIEW,
        rationale: `Auto-accepted: confidence ${projectedConfidence} >= threshold ${threshold}.`,
      });
      admitted.push(candidate.id);
    } catch {
      // Anything admitMemory itself refuses (collision, stale replacement
      // target, evidence re-verification failure, missing rationale -- none
      // apply here since a rationale is always supplied above, but any future
      // admitMemory check applies too) leaves the candidate exactly where a
      // human reviewer would find it. This is the only place this function
      // makes a decision; everything else is admitMemory's existing logic.
    }
  }
  return { admitted };
}
