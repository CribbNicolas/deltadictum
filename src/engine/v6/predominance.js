// Resolution ranking (highest precedence first): evidence -> recency -> authority -> predominance.
// Predominance is a decaying track-record tiebreaker ONLY, never a primary signal,
// so repeatedly-correct positions get a nudge without entrenching stale decisions.

export const PREDOMINANCE_WIN_BUMP = 0.25;

const AUTHORITY_RANK = { canonical: 4, validated: 3, inferred: 2, observed: 1, deprecated: 0 };

function metrics(atom) {
  return {
    evidence: Number(atom.evidence_supports ?? 0),
    recency: Date.parse(atom.valid_from ?? 0) || 0,
    authority: AUTHORITY_RANK[atom.authority] ?? 0,
    predominance: Number(atom.predominance ?? 0),
  };
}

/**
 * Returns whichever atom should win a contested resolution.
 *
 * Required fields on each atom: evidence_supports, valid_from, authority, predominance.
 * NOTE: evidence_supports is NOT returned by repository.getAtom — callers must supply
 * atoms enriched with evidence coverage (e.g. from a prior getEvidenceCoverage call)
 * before invoking this function.
 */
export function compareForResolution(a, b) {
  const ma = metrics(a);
  const mb = metrics(b);
  for (const key of ['evidence', 'recency', 'authority', 'predominance']) {
    if (ma[key] !== mb[key]) return ma[key] > mb[key] ? a : b;
  }
  return a; // total tie: keep the first deterministically
}
