// One reliability ladder, three projections — deliberately the same shape as
// src/engine/authority.js, and for the same reason: the entrenchment work exists
// because two authority tables had drifted apart, and a third independent table
// would recreate that failure.
//
// A level is a *ceiling* on attainable confidence, never a value to assign. It
// bounds what a source can reach without human review; it does not bound what a
// reviewer decides. Levels are declared, not learned: single-developer volumes
// give nothing to estimate a reliability function from, and never will (L6).
//
// `observed` marks the levels carried by a recorded host observation rather than
// by a file in the repository. Evidence verification derives which observation
// provenances it accepts from this flag, so the vocabulary lives here only.
//
// Ordered from least to most reliable.
export const RELIABILITY_LADDER = Object.freeze([
  { name: 'agent_claim', cap: 0.5 },
  { name: 'host', cap: 0.7, observed: true },
  { name: 'filesystem', cap: 0.85 },
  { name: 'user_correction', cap: 0.95, observed: true },
].map(Object.freeze));

export const RELIABILITY_RANK = Object.freeze(Object.fromEntries(
  RELIABILITY_LADDER.map((level, index) => [level.name, index])));

export const RELIABILITY_CAP = Object.freeze(Object.fromEntries(
  RELIABILITY_LADDER.map(level => [level.name, level.cap])));

export const VERIFIED_OBSERVATION_PROVENANCES = Object.freeze(
  RELIABILITY_LADDER.filter(level => level.observed).map(level => level.name));

const LEAST = RELIABILITY_LADDER[0].name;

// An unrecognised provenance is treated as least reliable rather than as an
// average: a value the engine does not recognise is not evidence of standing.
export function reliabilityRank(provenance) {
  return RELIABILITY_RANK[provenance] ?? RELIABILITY_RANK[LEAST];
}

// Capture origin is an agent-reported claim about how the memory was captured.
// `user_explicit` says the model believes the user asked for the save; it is not
// authenticated human approval, so it must never raise a ceiling. It can only
// lower one, which is why this is a factor at or below 1 rather than a level of
// its own — a factor scales every rung equally and so cannot invert the
// provenance order the way a competing cap would.
export const CAPTURE_ORIGIN_FACTOR = Object.freeze({
  model_initiated: 0.9,
  user_explicit: 1,
});

const LEAST_ORIGIN_FACTOR = Math.min(...Object.values(CAPTURE_ORIGIN_FACTOR));

// The most reliable source the memory can actually show, which is the most
// reliable *verified* artifact it carries. An unverified reference is an agent
// claim whatever source type it names, so it never raises the level.
export function sourceProvenance(atom) {
  let provenance = LEAST;
  for (const artifact of atom?.evidence_state?.artifacts ?? []) {
    if (artifact?.status !== 'verified') continue;
    if (reliabilityRank(artifact.provenance) > reliabilityRank(provenance)) provenance = artifact.provenance;
  }
  return RELIABILITY_RANK[provenance] === undefined ? LEAST : provenance;
}

// The ceiling this memory's source earns. Evidence composes with the cap rather
// than replacing it: three verified files do not exceed the filesystem ceiling,
// and a claimed explicit user request with nothing verified does not approach it.
export function reliabilityCeiling(atom) {
  const provenance = sourceProvenance(atom);
  const capture_origin = atom?.capture_origin;
  const factor = CAPTURE_ORIGIN_FACTOR[capture_origin] ?? LEAST_ORIGIN_FACTOR;
  return { provenance, capture_origin: capture_origin ?? null, factor,
    cap: Math.round(RELIABILITY_CAP[provenance] * factor * 1000) / 1000 };
}

// Human review sits above the ladder. The ladder bounds what is reachable
// *without* review; a reviewer granting canonical is making a decision, not
// presenting a source, and is not clamped by one.
export function cappedConfidence(atom, { authority } = {}) {
  if (authority === 'canonical') return 1;
  return reliabilityCeiling(atom).cap;
}
