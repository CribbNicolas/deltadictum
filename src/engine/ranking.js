import { triggerJaccard } from './health/deterioration.js';

// Ranking signals that complement lexical activation. Every factor stays inside
// [0,1] so the value scale, and the value-per-token gate that reads it, keep
// their meaning.

export const AUTHORITY_WEIGHT = { canonical: 1, validated: 0.85, inferred: 0.6, observed: 0.5, deprecated: 0 };

// An injection that should not have happened costs more than one that was
// missed, so knowledge that no human validated must clear a higher activation
// bar. Reviewed authorities keep the base floor: review already paid that cost.
const FLOOR_MULTIPLIER = { canonical: 1, validated: 1, inferred: 1.2, observed: 1.3 };
export function requiredActivation(atom, baseFloor) {
  return Math.min(1, baseFloor * (FLOOR_MULTIPLIER[atom?.authority] ?? 1.3));
}

// ACT-R base-level learning under Petrov's approximation: for n uses spread over
// an age of T seconds, B = ln(n / (1 - d)) - d * ln(T). DD records the use count
// and the creation time, not each individual use, which is exactly what the
// approximation needs; reading the retrieval log per request would not survive
// the PreToolUse hot path.
const DECAY = 0.5;
export function baseLevel(atom, now = Date.now()) {
  const uses = Number(atom?.activation_count ?? 0);
  if (!(uses > 0)) return null;
  const ageSeconds = Math.max(1, (now - (Date.parse(atom.created_at) || now)) / 1000);
  return Math.log(uses / (1 - DECAY)) - DECAY * Math.log(ageSeconds);
}

// Normalised inside the candidate set, never absolutely: a set with no usage
// history at all carries no evidence either way and is left untouched instead of
// being uniformly demoted. Unused knowledge ranks below used knowledge; among
// used knowledge, the best track record keeps its full value.
export const USAGE_WEIGHT = 0.15;
export function usageFactors(atoms, now = Date.now()) {
  const levels = atoms.map(atom => baseLevel(atom, now));
  const known = levels.filter(level => level !== null);
  if (!known.length) return levels.map(() => 1);
  const min = Math.min(...known);
  const max = Math.max(...known);
  return levels.map(level => {
    if (level === null) return 1 - USAGE_WEIGHT;
    if (!(max > min)) return 1;
    return 1 - USAGE_WEIGHT / 2 + (USAGE_WEIGHT / 2) * ((level - min) / (max - min));
  });
}

// Marginal relevance: a candidate that repeats a trigger already in the pack
// spends budget without adding advice. Neutral when nothing overlaps, so the
// first selection is never penalised.
export const REDUNDANCY_LAMBDA = 0.7;
export const NEAR_DUPLICATE = 0.8;
export function redundancyPenalty(atom, selected) {
  if (!selected.length) return 0;
  return Math.max(...selected.map(other => triggerJaccard(other.trigger, atom.trigger)));
}
export function applyRedundancy(value, penalty) {
  return value * (1 - (1 - REDUNDANCY_LAMBDA) * penalty);
}
