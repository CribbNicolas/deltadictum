// A v1 memory (a schema 7 atom) as a v2 memory (schema 8), following the mapping
// in docs/superpowers/specs/2026-10-08-dd-v2-design.md, section 9. Pure: one atom
// in, one memory out, with the review issues a person still has to settle.

export const BODY_MAX = 1500;
const KINDS = { lesson: 'trap', anti_memory: 'trap', decision: 'decision', claim: 'fact', procedure: 'procedure' };
const STATUSES = { active: 'active', contested: 'contested', candidate: 'candidate', superseded: 'superseded',
  archived: 'archived', rejected: 'archived', legacy: 'active' };
const FILE_SOURCES = ['file', 'diff', 'test_log'];
const PERSON_SOURCES = ['user_statement', 'user_approval', 'user_correction'];

const slashed = path => String(path).replaceAll('\\', '/').replace(/^\.\//, '');
const unique = list => [...new Set(list)];

function evidenceOf(atom) {
  const artifacts = new Map((atom.evidence_state?.artifacts ?? []).map(a => [`${a.source_type}:${a.source_ref}`, a]));
  return (atom.evidence_refs ?? []).map(ref => {
    const artifact = artifacts.get(`${ref.source_type}:${ref.source_ref}`);
    const summary = ref.summary ?? '';
    if (FILE_SOURCES.includes(ref.source_type)) {
      const hash = artifact?.status === 'verified' ? artifact.hash : null;
      return { type: 'file', path: slashed(ref.source_ref).replace(/#L\d+(?:-L?\d+)?$/, ''), ...(hash ? { sha256: hash } : {}), summary };
    }
    if (PERSON_SOURCES.includes(ref.source_type) || artifact?.provenance === 'user_correction') return { type: 'correction', ref: ref.source_ref, summary };
    if (ref.source_type === 'tool_output') return { type: 'observation', ref: ref.source_ref, summary };
    return { type: 'note', ref: ref.source_ref, summary };
  });
}

function bodyOf(atom) {
  const alternatives = (atom.alternatives ?? []).map(a => `${a.option} (${a.reason})`).join('; ');
  return [atom.behavior_delta, atom.why ? `Why: ${atom.why}` : '', alternatives ? `Alternatives considered: ${alternatives}` : '']
    .filter(Boolean).join('\n\n');
}

function legacyBody(atom, titles) {
  const now = atom.replaced_by ? titles.get(atom.replaced_by) ?? atom.replaced_by : 'no replacement recorded';
  return `No longer done: ${atom.behavior_delta}\n\nAbandoned because: ${atom.legacy_reason ?? 'not recorded'}\n\nNow: ${now}`;
}

export function convertV1(atom, { titles = new Map() } = {}) {
  const legacy = atom.lifecycle_state === 'legacy';
  const files = unique([...(atom.anchors?.files ?? []), ...(atom.applies_to?.files ?? [])].map(slashed));
  const keywords = atom.anchors?.keywords ?? [];
  const not = atom.anchors?.not_when ?? [];
  const triggers = [];
  if (files.length) triggers.push({ on: ['read', 'edit', 'write'], paths: files });
  if (keywords.length) triggers.push({ on: ['prompt', 'search'], keywords, ...(not.length ? { not } : {}) });
  const body = legacy ? legacyBody(atom, titles) : bodyOf(atom);
  const issues = ['not_derivable_missing'];
  if (body.length > BODY_MAX) issues.push('body_too_long');
  if (!triggers.length) issues.push('no_triggers');
  return {
    schema_version: 8,
    id: atom.id,
    project_id: atom.project_id,
    // A v1 legacy memory may share its topic with the memory that replaced it.
    topic: legacy ? `${atom.topic_key}-abandoned` : atom.topic_key,
    kind: legacy ? 'failed_approach' : KINDS[atom.memory_type] ?? 'trap',
    title: atom.title,
    body,
    not_derivable: '',
    triggers,
    evidence: evidenceOf(atom),
    status: STATUSES[atom.lifecycle_state] ?? 'archived',
    origin: atom.capture_origin === 'model_initiated' ? 'model_initiated' : 'user_explicit',
    replaces: atom.replaces ?? null,
    revisit_when: atom.revisit_when ?? [],
    review: { migrated: true, issues },
    created: atom.created_at ?? atom.valid_from ?? null,
    updated: atom.updated_at ?? atom.created_at ?? null,
  };
}
