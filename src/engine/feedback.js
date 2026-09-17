import { verifyReferences } from './evidence.js';
import { sanitizeText } from './v2/sanitizer.js';

export const OUTCOMES = ['helped', 'failed', 'refuted', 'not_applicable'];
export async function recordOutcome(request, { store, projectId }) {
  const atom = await store.getAtom(request.id, projectId);
  if (!atom) throw new Error('memory_not_found');
  if (!OUTCOMES.includes(request.outcome)) throw new Error('invalid_outcome');
  if (!request.summary?.trim() || request.summary.length > 800) throw new Error('outcome_summary_required_max_800');
  if (!request.task_id?.trim() || request.task_id.length > 200) throw new Error('task_id_required_max_200');
  const evidence = await verifyReferences(request.evidence_refs ?? [], { store, projectId });
  // A reported success is telemetry. It never raises authority, confidence or
  // promotion status. Independent reviewed evidence is required for those changes.
  return store.putFeedback({ project_id: projectId, atom_id: atom.id, task_id: request.task_id,
    outcome: request.outcome, summary: sanitizeText(request.summary), evidence,
    verification: evidence.verified_count > 0 ? 'artifact_verified' : 'agent_reported' });
}
