import { authorityRank } from '../authority.js';

// Resolution ranking (highest precedence first): evidence -> recency -> authority -> predominance.
// Predominance is a decaying track-record tiebreaker ONLY, never a primary signal,
// so repeatedly-correct positions get a nudge without entrenching stale decisions.

export const PREDOMINANCE_WIN_BUMP = 0.25;

// Bounded so a long-lived project cannot turn a tiebreaker into a primary
// signal by accumulation. Magnitude beyond the tiebreaker range carries no
// meaning.
export const PREDOMINANCE_CEILING = 999.999;

export const RESOLUTION_TIERS = Object.freeze(['evidence', 'recency', 'authority', 'predominance']);

/**
 * Count of evidence references whose artifact was verified against the repository.
 *
 * This is integrity coverage, not logical support: a verified reference means the
 * file exists and its bytes were checked, never that the claim follows from it.
 * An explicitly supplied evidence_supports wins, so a caller that has already
 * computed richer coverage can pass it in.
 */
export function evidenceSupports(atom) {
  if (atom?.evidence_supports != null) return Number(atom.evidence_supports) || 0;
  return Number(atom?.evidence_state?.verified_count ?? 0) || 0;
}

function metrics(atom) {
  return {
    evidence: evidenceSupports(atom),
    recency: Date.parse(atom?.valid_from ?? 0) || 0,
    authority: authorityRank(atom),
    predominance: Number(atom?.predominance ?? 0),
  };
}

// Compares the atoms themselves rather than their ids: an atom without an id is
// still comparable, and two of them must not collapse into the same winner.
function decide(a, b) {
  const ma = metrics(a);
  const mb = metrics(b);
  for (const tier of RESOLUTION_TIERS) {
    if (ma[tier] === mb[tier]) continue;
    return { winner: ma[tier] > mb[tier] ? a : b, basis: tier };
  }
  return { winner: null, basis: null };
}

/**
 * Recommend which side of a contested pair the ranking order favours, and say
 * which tier decided it.
 *
 * This is advice for a reviewer, never a decision: resolveMemories still
 * requires a human actor and a written rationale, and does not consult it.
 */
export function recommendResolution(a, b) {
  const { winner, basis } = decide(a, b);
  return { winner_id: winner?.id ?? null, basis, tie: !winner };
}

/**
 * Returns whichever atom should win a contested resolution.
 *
 * Evidence coverage is read from the atom's own evidence_state, so callers no
 * longer have to enrich atoms before comparing them.
 */
export function compareForResolution(a, b) {
  return decide(a, b).winner ?? a; // total tie: keep the first deterministically
}

/** Track-record nudge applied to the winner of a human resolution. */
export function bumpPredominance(atom) {
  return Math.min(PREDOMINANCE_CEILING, (Number(atom?.predominance ?? 0) || 0) + PREDOMINANCE_WIN_BUMP);
}
