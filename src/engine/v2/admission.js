import { authoredProse, looksNonEnglish } from '../language.js';
import { MEMORY_TYPES, MEMORY_SCOPES } from './constants.js';
import { hasUnsafeMemoryContent } from './sanitizer.js';
import { reliabilityCeiling } from '../reliability.js';

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEvidenceRefs(value) {
  return Array.isArray(value) && value.length > 0 && value.every(ref =>
    hasText(ref.source_type) && hasText(ref.source_ref) && hasText(ref.summary)
  );
}

function hasMinimumForms(value) {
  return value && hasText(value.micro) && hasText(value.short);
}

// The vocabulary that makes an anti_memory preventive. It is also what tells a
// restatement apart from an opposing instruction in the collision router below.
// English first (memories are English-only); the Spanish words remain for
// memories written before that rule.
const PREVENTIVE = /\b(do not|don't|never|must not|mustn't|avoid|block|warn|stop|reject|prevent|no|nunca|evitar|evita|impedir|rechazar)\b/i;

function containsUnsafePayload(payload) {
  const fields = ['title', 'trigger', 'behavior_delta', 'what', 'why'];
  return fields.some(field => hasUnsafeMemoryContent(payload[field])) ||
    Object.values(payload.retrieval_forms ?? {}).some(hasUnsafeMemoryContent);
}

export function decideAdmission(payload = {}) {
  const reasons = [];
  // Capture origin and evidence provenance are read and reported, never used to
  // reject: an unverified claim is still admissible as a candidate awaiting
  // review. What provenance decides is the ceiling the memory can reach, which
  // is applied at admission, where a confidence actually affects retrieval.
  const reliability = reliabilityCeiling(payload);

  if (!hasText(payload.project_id)) reasons.push('missing_project_id');
  if (!MEMORY_TYPES.includes(payload.memory_type)) reasons.push('invalid_memory_type');
  if (!MEMORY_SCOPES.includes(payload.scope)) reasons.push('invalid_scope');
  if (!hasText(payload.title)) reasons.push('missing_title');
  if (!hasText(payload.trigger)) reasons.push('missing_trigger');
  if (!hasText(payload.behavior_delta)) reasons.push('missing_behavior_delta');
  if (!hasText(payload.what)) reasons.push('missing_what');
  if (!hasText(payload.why)) reasons.push('missing_why');
  if (!hasText(payload.topic_key)) reasons.push('missing_topic_key');
  if (!hasEvidenceRefs(payload.evidence_refs)) reasons.push('missing_evidence_refs');
  if (!hasMinimumForms(payload.retrieval_forms)) reasons.push('missing_retrieval_forms');
  if (containsUnsafePayload(payload)) reasons.push('unsafe_memory_content');
  if (looksNonEnglish(authoredProse(payload))) reasons.push('memory_must_be_english');

  if (payload.memory_type === 'anti_memory' && !PREVENTIVE.test(payload.behavior_delta ?? '')) {
    reasons.push('anti_memory_requires_preventive_delta');
  }

  if (reasons.includes('missing_project_id') || reasons.includes('invalid_memory_type') || reasons.includes('invalid_scope') || reasons.includes('unsafe_memory_content') || reasons.includes('anti_memory_requires_preventive_delta')
      || reasons.includes('memory_must_be_english')) {
    return { decision: 'block', reasons, score: 0, reliability };
  }

  if (reasons.length > 0) {
    return { decision: 'observe', reasons, score: 0.25, reliability };
  }

  return { decision: 'write', reasons: ['durable_contract_satisfied'], score: 1, reliability };
}

// --- Trigger collisions -----------------------------------------------------
// A trigger match alone is not a duplicate. Two memories can share a trigger and
// apply to different files, components, operations or facts; the activation gate
// in ../activation.js treats those as different knowledge, and so does this. The
// scope comparison is the guard against the expensive error, which is routing a
// revision over a memory that only resembled the proposal in its trigger.
const scopeSet = (atom, kind) => new Set((atom.applies_to?.[kind] ?? []).map(v => String(v).trim().toLowerCase()).filter(Boolean));
const assumptionMap = atom => new Map((atom.assumptions ?? [])
  .filter(a => a.key).map(a => [a.key, JSON.stringify(a.equals ?? null)]));

// 'same' — the two carry the same conditions; 'different' — a declared dimension
// is disjoint, so they are distinct knowledge; 'ambiguous' — one declares what
// the other leaves open, or they partly overlap. Glob equality is textual: two
// different globs over the same tree read as 'different', which is the direction
// that creates a candidate rather than proposing a revision.
export function compareScope(a, b) {
  let ambiguous = false;
  for (const kind of ['files', 'components', 'operations']) {
    const left = scopeSet(a, kind), right = scopeSet(b, kind);
    if (!left.size && !right.size) continue;
    if (!left.size || !right.size) { ambiguous = true; continue; }
    const shared = [...left].filter(value => right.has(value));
    if (!shared.length) return 'different';
    if (shared.length !== left.size || shared.length !== right.size) ambiguous = true;
  }
  const left = assumptionMap(a), right = assumptionMap(b);
  for (const [key, value] of left) {
    if (!right.has(key)) ambiguous = true;
    else if (right.get(key) !== value) return 'different';
  }
  for (const key of right.keys()) if (!left.has(key)) ambiguous = true;
  return ambiguous ? 'ambiguous' : 'same';
}

const EFFECTIVE_STATES = ['active', 'contested'];

// A revision restates a memory; it does not reverse it. Two memories that share a
// trigger and a scope while telling the agent opposite things are a contradiction,
// which DD resolves through declareContradiction and review, not by superseding
// one with the other. The test is the same preventive vocabulary the anti_memory
// gate uses: lexical, because that is all a hook can afford (L3).
export function agreesInDirection(a, b) {
  if (a.memory_type !== b.memory_type) return false;
  return PREVENTIVE.test(a.behavior_delta ?? '') === PREVENTIVE.test(b.behavior_delta ?? '');
}

// Routes the collision the write path already computes. Peers on the proposal's
// own topic_key are excluded: a same-topic proposal is a revision by
// construction and the write path already points `replaces` at it.
//
// Only an effective peer with the same scope, and only when exactly one such
// peer collides, becomes an `update`. Everything else that collides without a
// disjoint scope is written as a candidate flagged as a suspected pair, so the
// reviewer sees the two together. Ambiguity escalates: there is no background
// judge to arbitrate (L2) and no semantic similarity to lean on (L3).
export function routeTriggerCollision(payload, peers = [], threshold = 0.5, similarity) {
  const collisions = peers
    .filter(peer => peer.id !== payload.id && peer.topic_key !== payload.topic_key)
    .map(peer => ({ id: peer.id, topic_key: peer.topic_key,
      effective: EFFECTIVE_STATES.includes(peer.lifecycle_state),
      scope: compareScope(peer, payload),
      agrees: agreesInDirection(peer, payload),
      jaccard: Math.round(similarity(peer.trigger, payload.trigger) * 1000) / 1000 }))
    .filter(c => c.jaccard >= threshold)
    .sort((a, b) => b.jaccard - a.jaccard);
  if (!collisions.length) return { decision: 'write', reasons: [] };
  const mergeable = collisions.filter(c => c.effective && c.scope === 'same' && c.agrees);
  if (mergeable.length === 1) {
    return { decision: 'update', reasons: ['trigger_collision_same_scope'], replaces: mergeable[0].id,
      suspected_pair: [mergeable[0].id] };
  }
  // Two equally good revision targets is itself ambiguity, not a reason to pick one.
  const suspected = collisions.filter(c => c.scope !== 'different').map(c => c.id).slice(0, 20);
  if (!suspected.length) return { decision: 'write', reasons: [] };
  return { decision: 'write', reasons: ['suspected_duplicate_pair'], suspected_pair: suspected };
}
