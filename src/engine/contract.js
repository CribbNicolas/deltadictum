import { randomUUID } from 'node:crypto';
import { sanitizeText, hasUnsafeMemoryContent } from './v2/sanitizer.js';
import { MEMORY_TYPES, MEMORY_SCOPES } from './v2/constants.js';
import { cappedConfidence } from './reliability.js';

export const SCHEMA_VERSION = 7;
export const CAPTURE_ORIGINS = ['model_initiated', 'user_explicit'];
// `unknown` marks knowledge captured before the entry point was recorded.
export const CAPTURE_SOURCES = ['agent', 'local_ui', 'unknown'];

// Why a stored atom is not one this build reads, or null when it is. Nothing is
// defaulted or guessed: an atom this rejects is never indexed or recalled, and
// the health report names it so a person can fix or delete the file.
export function unsupportedReason(atom) {
  if (!atom?.id) return 'missing_id';
  if (atom.schema_version !== SCHEMA_VERSION) return 'unsupported_schema_version';
  if (!CAPTURE_ORIGINS.includes(atom.capture_origin)) return 'invalid_capture_origin';
  if (!CAPTURE_SOURCES.includes(atom.capture_source)) return 'invalid_capture_source';
  return null;
}
const text = value => sanitizeText(value ?? '').trim();
const strings = value => [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];
export const MATERIAL_FIELDS = ['title', 'memory_type', 'scope', 'trigger', 'behavior_delta', 'why', 'trigger_variants',
  'applies_to', 'assumptions', 'revisit_when', 'alternatives', 'evidence_refs', 'valid_from', 'valid_until'];

export function deriveForms(atom) {
  const micro = atom.behavior_delta;
  const short = `${micro} Why: ${atom.why}`;
  const alternatives = atom.alternatives.map(a => `${a.option}: ${a.reason}`).join('; ');
  return { micro, short, full: alternatives ? `${short} Alternatives: ${alternatives}` : short };
}

// Only authored content crosses this boundary. IDs, evidence verification, review,
// lifecycle, scores and authority are owned by the engine, not by proposal payloads.
export function normalizeProposal(raw = {}, projectId = raw.project_id, { captureSource = 'agent' } = {}) {
  const behavior_delta = text(raw.behavior_delta);
  const atom = {
    id: randomUUID(), project_id: projectId, schema_version: SCHEMA_VERSION,
    capture_origin: captureSource === 'local_ui' ? 'user_explicit' : raw.capture_origin ?? 'user_explicit',
    capture_source: captureSource,
    memory_type: raw.memory_type ?? 'lesson', scope: raw.scope ?? 'project',
    title: text(raw.title) || behavior_delta.slice(0, 100),
    topic_key: text(raw.topic_key).toLowerCase(), trigger: text(raw.trigger), behavior_delta,
    what: behavior_delta, why: text(raw.why),
    tags: strings(raw.tags), trigger_variants: strings(raw.trigger_variants),
    applies_to: {
      files: strings(raw.applies_to?.files).map(p => p.replaceAll('\\', '/')),
      components: strings(raw.applies_to?.components), operations: strings(raw.applies_to?.operations),
    },
    assumptions: (Array.isArray(raw.assumptions) ? raw.assumptions : []).map(a => typeof a === 'string'
      ? { description: text(a) } : { key: text(a.key), equals: a.equals, description: text(a.description) }),
    revisit_when: (Array.isArray(raw.revisit_when) ? raw.revisit_when : []).map(c => typeof c === 'string'
      ? { kind: 'manual', description: text(c) } : {
        kind: c.kind, description: text(c.description), ...(c.path ? { path: text(c.path) } : {}),
        ...(c.key ? { key: text(c.key), equals: c.equals } : {}), ...(c.date ? { date: c.date } : {}),
      }),
    alternatives: (Array.isArray(raw.alternatives) ? raw.alternatives : [])
      .map(a => ({ option: text(a.option), reason: text(a.reason) })),
    evidence_refs: (Array.isArray(raw.evidence_refs) ? raw.evidence_refs : []).map(ref => ({
      source_type: text(ref.source_type), source_ref: text(ref.source_ref), summary: text(ref.summary),
    })),
    authority: 'inferred', lifecycle_state: 'candidate',
    valid_from: raw.valid_from ?? new Date().toISOString(), valid_until: raw.valid_until ?? null,
  };
  atom.retrieval_forms = deriveForms(atom);
  // Derived from the reliability ladder rather than stamped as a constant. No
  // reference is verified yet at this point, so every proposal lands on the
  // unverified rung by construction; the point is that the number is the
  // ladder's and can never exceed what the source turns out to earn.
  atom.confidence = cappedConfidence(atom, { authority: atom.authority });
  return atom;
}

export function validateContract(atom) {
  const reasons = [];
  if (!atom.project_id) reasons.push('missing_project_id');
  if (!CAPTURE_ORIGINS.includes(atom.capture_origin)) reasons.push('invalid_capture_origin');
  if (!['agent', 'local_ui'].includes(atom.capture_source)) reasons.push('invalid_capture_source');
  if (!MEMORY_TYPES.includes(atom.memory_type)) reasons.push('invalid_memory_type');
  if (!MEMORY_SCOPES.includes(atom.scope)) reasons.push('invalid_scope');
  if (!Number.isFinite(Date.parse(atom.valid_from))) reasons.push('invalid_valid_from');
  if (atom.valid_until && (!Number.isFinite(Date.parse(atom.valid_until)) || Date.parse(atom.valid_until) <= Date.parse(atom.valid_from))) reasons.push('invalid_valid_until');
  for (const key of ['trigger_variants', 'assumptions', 'revisit_when', 'alternatives', 'evidence_refs', 'tags']) {
    if (atom[key].length > 12) reasons.push(`too_many_${key}`);
  }
  if (JSON.stringify(atom).length > 16000) reasons.push('memory_too_large');
  if (hasUnsafeMemoryContent(JSON.stringify(atom))) reasons.push('unsafe_memory_content');
  for (const a of atom.assumptions) {
    if (!a.description || (a.key && !['string', 'boolean', 'number'].includes(typeof a.equals))) reasons.push('invalid_assumption');
  }
  for (const c of atom.revisit_when) {
    if (!['manual', 'file_changed', 'fact_changed', 'date'].includes(c.kind) || !c.description) reasons.push('invalid_revision_condition');
    if (c.kind === 'file_changed' && !c.path) reasons.push('revision_path_required');
    if (c.kind === 'fact_changed' && (!c.key || c.equals === undefined)) reasons.push('revision_fact_required');
    if (c.kind === 'date' && !Number.isFinite(Date.parse(c.date))) reasons.push('invalid_revision_date');
  }
  for (const glob of atom.applies_to.files) {
    if (glob.startsWith('/') || glob.includes(':') || glob.split('/').includes('..') || glob.length > 200) reasons.push('invalid_file_scope');
  }
  return [...new Set(reasons)];
}

export function sameKnowledge(a, b) {
  // valid_from defaults to capture time; it is not evidence of material change.
  const authored = (atom, key) => key === 'revisit_when' ? (atom[key] ?? []).map(({ hash, ...rule }) => rule) : atom[key] ?? null;
  return MATERIAL_FIELDS.filter(k => k !== 'valid_from').every(key => JSON.stringify(authored(a, key)) === JSON.stringify(authored(b, key)));
}
