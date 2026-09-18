import { contentTokens } from '../v4/trigger-match.js';

export const DEFAULT_HEALTH_THRESHOLDS = {
  live_bloat: { watch: 80, deteriorated: 200 },
  prefix_crowding: { depth: 2, watch: 12, deteriorated: 25 },
  trigger_collision: { jaccard: 0.5, watch: 1, deteriorated: 8 },
  dead_inferred: { min_age_days: 14, watch: 5, deteriorated: 20 },
  unresolved_contest: { min_age_days: 7, watch: 1, deteriorated: 3 },
  supersession_churn: { watch: 3, deteriorated: 5 },
  cap_saturation: { window: 50, min_events: 10, watch: 0.2, deteriorated: 0.5 },
  // Retirement is an action, not a warning, so it does not share `dead_inferred`'s
  // numbers. A memory is retired only once the project has retrieved often enough,
  // since the memory was written, that "its trigger never fired" means something.
  // The health snapshot supplies at most 50 retrieval events, so 40 is "almost
  // every retrieval this project has a record of, and none of them chose this".
  retirement: { min_age_days: 90, min_retrieval_events: 40 },
};

// The config block and the threshold defaults are the same shape; a project
// overrides individual numbers without having to restate a whole block.
export function healthThresholdsFromConfig(config) {
  const base = structuredClone(DEFAULT_HEALTH_THRESHOLDS);
  const override = config?.health;
  if (!override) return base;
  for (const key of Object.keys(base)) {
    if (override[key] && typeof override[key] === 'object') Object.assign(base[key], override[key]);
  }
  return base;
}

export function topicPrefix(topicKey, depth = 2) {
  return String(topicKey ?? '').split('/').filter(Boolean).slice(0, depth).join('/');
}

function jaccardSets(left, right) {
  if (left.size === 0 && right.size === 0) return 0;
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function triggerJaccard(a, b) {
  return jaccardSets(new Set(contentTokens(a)), new Set(contentTokens(b)));
}

export function indicatorStatus(value, watch, deteriorated) {
  if (value >= deteriorated) return 'deteriorated';
  if (value >= watch) return 'watch';
  return 'healthy';
}

export function overallStatus(indicators = []) {
  let worst = 'healthy';
  for (const row of indicators) {
    if (row.status === 'deteriorated') return 'deteriorated';
    if (row.status === 'watch') worst = 'watch';
  }
  return worst;
}

export function emptySnapshot(projectId) {
  return {
    project_id: projectId,
    atoms: [],
    retrieval_events: [],
    observations: { unreviewed: 0, oldest_at: null },
  };
}

const LIVE_STATES = new Set(['active', 'contested']);
const COUNT_STATES = ['active', 'contested', 'candidate', 'superseded', 'archived', 'rejected'];
const OFFENDER_CAP = 20;

function ageDays(iso, nowIso) {
  if (!iso) return 0;
  return (Date.parse(nowIso) - Date.parse(iso)) / 86400000;
}

function isLive(atom) {
  return LIVE_STATES.has(atom.lifecycle_state);
}

function capOffenders(list) {
  return list.slice(0, OFFENDER_CAP);
}

function makeIndicator(id, layer, value, watch, deteriorated, offenders = [], extra = {}) {
  return {
    id,
    layer,
    status: indicatorStatus(value, watch, deteriorated),
    value,
    watch_at: watch,
    deteriorated_at: deteriorated,
    offenders: capOffenders(offenders),
    ...extra,
  };
}

// The chances a trigger had to fire: retrievals this project ran after the
// memory was written. A memory written yesterday into a quiet project has had
// none, however old the project is.
function opportunities(events, createdAt) {
  const written = Date.parse(createdAt ?? '');
  if (!Number.isFinite(written)) return 0;
  return events.filter(event => Date.parse(event.created_at) >= written).length;
}

// Retirement by disuse, not by age. The conjunction is `dead_inferred`'s —
// effective, low authority, past a minimum age, never activated — with two
// tightenings: the thresholds are the retirement block's, and the trigger must
// have had chances to fire. Contested memories are excluded: a dispute is a
// human's open question, not disuse.
export function retirementCandidates(snapshot, nowIso, thresholds = DEFAULT_HEALTH_THRESHOLDS) {
  const policy = thresholds.retirement ?? DEFAULT_HEALTH_THRESHOLDS.retirement;
  const events = snapshot.retrieval_events ?? [];
  return (snapshot.atoms ?? []).filter(atom =>
    atom.lifecycle_state === 'active'
    && (atom.authority === 'inferred' || atom.authority === 'observed')
    && (atom.activation_count ?? 0) === 0
    && ageDays(atom.created_at, nowIso) >= policy.min_age_days
    && opportunities(events, atom.created_at) >= policy.min_retrieval_events,
  );
}

export function assessDeterioration(snapshot, nowIso, thresholds = DEFAULT_HEALTH_THRESHOLDS) {
  const atoms = snapshot.atoms ?? [];
  const liveAtoms = atoms.filter(isLive);
  const live = {
    active: 0,
    contested: 0,
    candidate: 0,
    superseded: 0,
    archived: 0,
    rejected: 0,
    total: atoms.length,
  };
  for (const atom of atoms) {
    if (COUNT_STATES.includes(atom.lifecycle_state)) live[atom.lifecycle_state] += 1;
  }

  const indicators = [];
  const bloat = live.active + live.contested;
  indicators.push(makeIndicator(
    'live_bloat',
    'store',
    bloat,
    thresholds.live_bloat.watch,
    thresholds.live_bloat.deteriorated,
  ));

  const prefixes = new Map();
  for (const atom of liveAtoms) {
    const prefix = topicPrefix(atom.topic_key, thresholds.prefix_crowding.depth);
    if (!prefix) continue;
    const bucket = prefixes.get(prefix) ?? { prefix, count: 0, ids: [] };
    bucket.count += 1;
    bucket.ids.push(atom.id);
    prefixes.set(prefix, bucket);
  }
  let maxPrefix = 0;
  const crowded = [];
  for (const bucket of prefixes.values()) {
    if (bucket.count > maxPrefix) maxPrefix = bucket.count;
    if (bucket.count >= thresholds.prefix_crowding.watch) {
      crowded.push({ prefix: bucket.prefix, count: bucket.count, ids: capOffenders(bucket.ids) });
    }
  }
  crowded.sort((a, b) => b.count - a.count);
  indicators.push(makeIndicator(
    'prefix_crowding',
    'store',
    maxPrefix,
    thresholds.prefix_crowding.watch,
    thresholds.prefix_crowding.deteriorated,
    crowded,
  ));

  const tokenSets = liveAtoms.map(atom => new Set(contentTokens(atom.trigger)));
  const pairs = [];
  const pairCap = Math.max(OFFENDER_CAP, thresholds.trigger_collision.deteriorated);
  let collisionCount = 0;
  outer: for (let i = 0; i < liveAtoms.length; i += 1) {
    for (let j = i + 1; j < liveAtoms.length; j += 1) {
      const jaccard = jaccardSets(tokenSets[i], tokenSets[j]);
      if (jaccard < thresholds.trigger_collision.jaccard) continue;
      collisionCount += 1;
      if (pairs.length < OFFENDER_CAP) {
        pairs.push({
          id_a: liveAtoms[i].id,
          id_b: liveAtoms[j].id,
          jaccard: Math.round(jaccard * 1000) / 1000,
        });
      }
      if (collisionCount >= pairCap) break outer;
    }
  }
  indicators.push(makeIndicator(
    'trigger_collision',
    'store',
    collisionCount,
    thresholds.trigger_collision.watch,
    thresholds.trigger_collision.deteriorated,
    pairs,
  ));

  const dead = liveAtoms.filter(atom =>
    (atom.authority === 'inferred' || atom.authority === 'observed')
    && (atom.activation_count ?? 0) === 0
    && ageDays(atom.created_at, nowIso) >= thresholds.dead_inferred.min_age_days,
  );
  indicators.push(makeIndicator(
    'dead_inferred',
    'store',
    dead.length,
    thresholds.dead_inferred.watch,
    thresholds.dead_inferred.deteriorated,
    dead.map(atom => ({ id: atom.id, topic_key: atom.topic_key, created_at: atom.created_at })),
    { retirable: retirementCandidates(snapshot, nowIso, thresholds).map(atom => atom.id) },
  ));

  const contests = atoms.filter(atom =>
    atom.lifecycle_state === 'contested'
    && atom.contested_at
    && ageDays(atom.contested_at, nowIso) >= thresholds.unresolved_contest.min_age_days,
  );
  indicators.push(makeIndicator(
    'unresolved_contest',
    'store',
    contests.length,
    thresholds.unresolved_contest.watch,
    thresholds.unresolved_contest.deteriorated,
    contests.map(atom => ({ id: atom.id })),
  ));

  const supersededByKey = new Map();
  for (const atom of atoms) {
    if (atom.lifecycle_state !== 'superseded') continue;
    supersededByKey.set(atom.topic_key, (supersededByKey.get(atom.topic_key) ?? 0) + 1);
  }
  let maxChurn = 0;
  const churnOffenders = [];
  for (const [topic_key, count] of supersededByKey) {
    if (count > maxChurn) maxChurn = count;
    if (count >= thresholds.supersession_churn.watch) churnOffenders.push({ topic_key, count });
  }
  churnOffenders.sort((a, b) => b.count - a.count);
  indicators.push(makeIndicator(
    'supersession_churn',
    'store',
    maxChurn,
    thresholds.supersession_churn.watch,
    thresholds.supersession_churn.deteriorated,
    churnOffenders,
  ));

  const cap = thresholds.cap_saturation;
  const events = (snapshot.retrieval_events ?? [])
    .slice()
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, cap.window);
  if (events.length < cap.min_events) {
    indicators.push({
      id: 'cap_saturation',
      layer: 'retrieve',
      status: 'skipped',
      value: 0,
      watch_at: cap.watch,
      deteriorated_at: cap.deteriorated,
      reason: 'insufficient_telemetry',
      offenders: [],
    });
  } else {
    const saturated = events.filter(event => (event.returned_atom_ids ?? []).length >= 8).length;
    indicators.push(makeIndicator(
      'cap_saturation',
      'retrieve',
      saturated / events.length,
      cap.watch,
      cap.deteriorated,
    ));
  }

  return {
    project_id: snapshot.project_id,
    generated_at: nowIso,
    status: overallStatus(indicators),
    live,
    indicators,
    observations: snapshot.observations ?? { unreviewed: 0, oldest_at: null },
  };
}
