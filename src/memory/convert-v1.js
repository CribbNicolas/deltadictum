// A v1 memory (a schema 7 atom) as a v2 memory (schema 8). Pure: one atom
// in, one memory out, with the review issues a person still has to settle.

export const BODY_MAX = 1500;
const KINDS = { lesson: 'trap', anti_memory: 'trap', decision: 'decision', claim: 'fact', procedure: 'procedure' };
const STATUSES = { active: 'active', contested: 'contested', candidate: 'candidate', superseded: 'superseded',
  archived: 'archived', rejected: 'archived', legacy: 'active' };
const FILE_SOURCES = ['file', 'diff', 'test_log'];
const PERSON_SOURCES = ['user_statement', 'user_approval', 'user_correction'];

const slashed = path => String(path).replaceAll('\\', '/').replace(/^\.\//, '');
const unique = list => [...new Set(list)];
const LINES = /#L\d+(?:-L?\d+)?$/;
// A v1 scope entry naming a folder ("tests/") limited where a memory applied; v1
// never let a folder anchor it. As a trigger it fires on most work (tests/**
// reached 52% of the bench's runs), so it is left to a person to narrow.
const isFolder = entry => slashed(entry).endsWith('/');

// A v1 file reference is a repository path, possibly followed by words about it
// ("src/hooks/banner.js sessionBanner()"); some were never paths ("npm test").
function referencedPath(ref) {
  const [head, ...rest] = slashed(ref).trim().split(/\s+/);
  const path = String(head ?? '').replace(LINES, '');
  // A repository path: never absolute, a drive, a network share (//server) or a parent segment.
  const isPath = path && !path.startsWith('-') && !path.startsWith('/') && !path.includes(':') && !path.split('/').includes('..')
    && (path.includes('/') || /\.[a-z0-9]+$/i.test(path));
  return isPath ? { path, rest: rest.join(' ') } : null;
}

const SUMMARY_MAX = 500;
const clip = text => (text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 3)}...` : text);

function evidenceOf(atom, issues) {
  const artifacts = new Map((atom.evidence_state?.artifacts ?? []).map(a => [`${a.source_type}:${a.source_ref}`, a]));
  return (atom.evidence_refs ?? []).map(ref => {
    const artifact = artifacts.get(`${ref.source_type}:${ref.source_ref}`);
    const summary = clip(ref.summary ?? '');
    if (FILE_SOURCES.includes(ref.source_type)) {
      const target = referencedPath(ref.source_ref);
      if (!target) { issues.add('evidence_not_a_path'); return { type: 'note', ref: ref.source_ref, summary }; }
      // A hash covers the whole file, so it stays only when the reference was the path alone.
      const hash = artifact?.status === 'verified' && !target.rest ? artifact.hash : null;
      return { type: 'file', path: target.path, ...(hash ? { sha256: hash } : {}), summary: target.rest ? clip(`${target.rest}: ${summary}`) : summary };
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

// v1 rarely recorded replaced_by, but a legacy memory shares its topic with the
// live memory that replaced it: that one is the replacement.
function legacyBody(atom, titles, liveByTopic, issues) {
  const now = atom.replaced_by ? titles.get(atom.replaced_by) ?? atom.replaced_by : liveByTopic.get(atom.topic_key);
  if (!now) issues.add('replacement_unknown');
  return `No longer done: ${atom.behavior_delta}\n\nAbandoned because: ${atom.legacy_reason ?? 'not recorded'}\n\nNow: ${now ?? 'no replacement recorded'}`;
}

// titles: v1 id to title; liveByTopic: topic to the title of the live v1 memory on it.
export function convertV1(atom, { titles = new Map(), liveByTopic = new Map() } = {}) {
  const legacy = atom.lifecycle_state === 'legacy';
  const scope = [...(atom.anchors?.files ?? []), ...(atom.applies_to?.files ?? [])];
  const files = unique(scope.filter(entry => !isFolder(entry)).map(slashed));
  const keywords = atom.anchors?.keywords ?? [];
  const not = atom.anchors?.not_when ?? [];
  const triggers = [];
  if (files.length) triggers.push({ on: ['read', 'edit', 'write'], paths: files });
  if (keywords.length) triggers.push({ on: ['prompt', 'search'], keywords, ...(not.length ? { not } : {}) });
  const found = new Set(scope.some(isFolder) ? ['folder_scope'] : []);
  const body = legacy ? legacyBody(atom, titles, liveByTopic, found) : bodyOf(atom);
  const evidence = evidenceOf(atom, found);
  const issues = ['not_derivable_missing', ...found];
  if (body.length > BODY_MAX) issues.push('body_too_long');
  if (!triggers.length) issues.push('no_triggers');
  // What schema 8 has no field for stays with the memory for its reviewer: the
  // migration deletes the v1 files, so dropping it would lose it.
  const v1 = Object.fromEntries([
    ['trigger', typeof atom.trigger === 'string' && atom.trigger.trim() ? atom.trigger : undefined],
    ['assumptions', atom.assumptions?.length ? atom.assumptions : undefined],
    ['valid_until', atom.valid_until || undefined],
  ].filter(([, value]) => value !== undefined));
  return {
    schema_version: 8,
    id: atom.id,
    project_id: atom.project_id,
    // A v1 legacy memory shares its topic with the memory that replaced it, and
    // possibly with other abandoned approaches: its own id keeps it apart.
    topic: legacy ? `${atom.topic_key}-abandoned-${String(atom.id).slice(0, 8).toLowerCase().replace(/[^a-z0-9_-]/g, '-')}` : atom.topic_key,
    kind: legacy ? 'failed_approach' : KINDS[atom.memory_type] ?? 'trap',
    title: atom.title,
    body,
    not_derivable: '',
    triggers,
    evidence,
    status: STATUSES[atom.lifecycle_state] ?? 'archived',
    origin: atom.capture_origin === 'model_initiated' ? 'model_initiated' : 'user_explicit',
    replaces: atom.replaces ?? null,
    revisit_when: atom.revisit_when ?? [],
    review: { migrated: true, issues, ...(Object.keys(v1).length ? { v1 } : {}),
      // A person reviewed it in v1's local UI: retirement must not undo that.
      ...(atom.review?.source === 'local_ui' ? { accepted: { by: 'person', at: atom.review.reviewed_at ?? null } } : {}) },
    created: atom.created_at ?? atom.valid_from ?? null,
    updated: atom.updated_at ?? atom.created_at ?? null,
  };
}
