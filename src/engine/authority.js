// One authority ladder, two projections. Resolution compares ranks; retrieval
// multiplies weights. They previously lived in separate files with separate
// tables, so nothing stopped them disagreeing about which authority outranks
// which. Deriving both from this list makes that disagreement impossible.
//
// Ordered from least to most trusted.
export const AUTHORITY_LADDER = Object.freeze([
  { name: 'deprecated', weight: 0 },
  { name: 'observed', weight: 0.5 },
  { name: 'inferred', weight: 0.6 },
  { name: 'validated', weight: 0.85 },
  { name: 'canonical', weight: 1 },
]);

export const AUTHORITY_RANK = Object.freeze(Object.fromEntries(
  AUTHORITY_LADDER.map((level, index) => [level.name, index])));

export const AUTHORITY_WEIGHT = Object.freeze(Object.fromEntries(
  AUTHORITY_LADDER.map(level => [level.name, level.weight])));

// An unknown authority is treated as the least trusted rather than as an
// average: a value the engine does not recognise is not evidence of standing.
export function authorityRank(atom) {
  return AUTHORITY_RANK[atom?.authority] ?? 0;
}
