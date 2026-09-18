import { verifyReferences } from './evidence.js';
import { cappedConfidence, reliabilityCeiling } from './reliability.js';

// Knowledge written before the reliability ladder carries a confidence the
// ladder can never produce — a flat constant, often with no `evidence_state` at
// all, because verification did not exist when it was stored. This re-derives
// both from what the stored references actually resolve to now.
//
// It is not a review and it must not look like one. Authority, lifecycle state
// and the review stamp are all human decisions and are left exactly where they
// are; only the two derived fields move. A memory whose reviewer granted
// `canonical` therefore stays at 1, above the ladder, as it does everywhere else.
//
// Read-only unless `apply` is set, because it rewrites git-tracked knowledge.
export async function reverifyStoredEvidence({ store, projectId, apply = false } = {}) {
  const atoms = await store.listAtoms({ projectId });
  const changed = [];
  const skipped = [];
  for (const atom of atoms) {
    if (!atom.evidence_refs?.length) continue;
    const verified = await verifyReferences(atom.evidence_refs, { store, projectId });
    // Admission refuses a reference that escapes the repository rather than
    // recording it, so this refuses it too instead of stamping a partial result.
    if (verified.artifacts.some(a => a.status === 'out_of_scope')) {
      skipped.push({ id: atom.id, topic_key: atom.topic_key, reason: 'evidence_scope_violation' });
      continue;
    }
    // Review already established support; re-reading the bytes does not undo it.
    const evidence_state = { ...verified, support: atom.review ? 'human_reviewed' : verified.support };
    const confidence = cappedConfidence({ ...atom, evidence_state }, { authority: atom.authority });
    // `checked_at` records when the bytes were last read, not what they said, so
    // comparing it would make every run report a change and rewrite every file.
    const substance = state => JSON.stringify({ ...state, checked_at: undefined });
    const settled = atom.confidence === confidence && atom.evidence_state
      && substance(atom.evidence_state) === substance(evidence_state);
    if (settled) continue;
    // A row where `from` equals `to` gained a verification record without its
    // confidence moving — the usual case for knowledge a reviewer made canonical.
    changed.push({ id: atom.id, topic_key: atom.topic_key, authority: atom.authority,
      provenance: reliabilityCeiling({ ...atom, evidence_state }).provenance,
      from: atom.confidence, to: confidence });
    if (apply) await store.putAtom({ ...atom, evidence_state, confidence });
  }
  return { applied: Boolean(apply), scanned: atoms.length, changed, skipped };
}
