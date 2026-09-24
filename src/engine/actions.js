import { randomUUID } from 'node:crypto';
import { normalizeProposal, validateContract } from './contract.js';
import { decideAdmission } from './v2/admission.js';
import { looksNonEnglish } from './language.js';
import { sanitizeText } from './v2/sanitizer.js';
import { assertTopicKeyPath } from '../store/paths.js';
import { HUMAN_REVIEW, planResolution } from './lifecycle.js';
import { stampRevisionFiles, verifyReferences } from './evidence.js';
import { cappedConfidence } from './reliability.js';

// An action is a request to change the store, filed by the agent (the MCP `act`
// tool) and applied only by a person in the audit UI. Filing never changes a
// memory: it validates, records a snapshot of every target and waits.
export const ACTION_KINDS = ['archive', 'restore', 'delete', 'legacy', 'merge', 'split', 'retopic', 'resolve'];

// Which states each kind may act on, how many targets and which fields it needs.
const RULES = {
  archive: { states: ['active', 'contested', 'superseded', 'legacy'], min: 1, max: 50, fields: ['archived_reason'] },
  restore: { states: ['archived', 'legacy'], min: 1, max: 50, fields: [] },
  delete: { states: ['archived', 'rejected', 'candidate'], min: 1, max: 50, fields: [] },
  legacy: { states: ['active', 'contested', 'superseded'], min: 1, max: 50, fields: ['legacy_reason'] },
  merge: { states: ['active', 'contested', 'superseded', 'legacy'], min: 2, max: 10, fields: ['result'] },
  split: { states: ['active', 'contested'], min: 1, max: 1, fields: ['results'] },
  retopic: { states: ['active', 'contested'], min: 1, max: 1, fields: ['topic_key'] },
  resolve: { states: ['contested'], min: 2, max: 2, fields: ['winner', 'loser_state'] },
};
const FIELDS = ['archived_reason', 'legacy_reason', 'replaced_by', 'result', 'results', 'topic_key', 'winner', 'loser_state'];
const text = value => sanitizeText(value ?? '').trim();

// What a target looked like when the action was filed; applying refuses any change.
export const snapshotOf = atom => `${atom.updated_at}|${atom.lifecycle_state}`;

// The reasons a proposal-shaped result would be refused, or [] when admissible.
export function checkProposal(raw, projectId) {
  const atom = normalizeProposal({ ...raw, project_id: projectId }, projectId, { captureSource: 'agent' });
  const gate = decideAdmission(atom);
  return [...validateContract(atom), ...(gate.decision === 'write' ? [] : gate.reasons)];
}

async function validate(raw, { store, projectId }) {
  const rule = RULES[raw.kind];
  if (!rule) return 'unknown_action_kind';
  const targets = [...new Set((raw.targets ?? []).map(String))];
  if (targets.length < rule.min || targets.length > rule.max) return `target_count:${rule.min}-${rule.max}`;
  for (const field of rule.fields) if (raw[field] === undefined || raw[field] === null || raw[field] === '') return `field_required:${field}`;
  const rationale = text(raw.rationale);
  if (!rationale) return 'rationale_required';
  if (looksNonEnglish([rationale, raw.archived_reason, raw.legacy_reason].filter(Boolean).join(' '))) return 'action_must_be_english';
  const atoms = [];
  for (const id of targets) {
    const atom = await store.getAtom(id, projectId);
    if (!atom) return `target_not_found:${id}`;
    if (!rule.states.includes(atom.lifecycle_state)) return `target_state_not_allowed:${id}:${atom.lifecycle_state}`;
    atoms.push(atom);
  }
  if (raw.kind === 'merge') {
    // A practice cannot be both current and abandoned.
    const legacy = atoms.filter(a => a.lifecycle_state === 'legacy').length;
    if (legacy && legacy !== atoms.length) return 'mixed_legacy_merge';
    if (legacy && !text(raw.legacy_reason)) return 'field_required:legacy_reason';
    const reasons = checkProposal(raw.result, projectId);
    if (reasons.length) return `result_not_admissible:${reasons.join(',')}`;
  }
  if (raw.kind === 'split') {
    if (!Array.isArray(raw.results) || raw.results.length < 2 || raw.results.length > 5) return 'split_results:2-5';
    for (const result of raw.results) {
      const reasons = checkProposal(result, projectId);
      if (reasons.length) return `result_not_admissible:${reasons.join(',')}`;
    }
  }
  if (raw.kind === 'retopic') { try { assertTopicKeyPath(raw.topic_key); } catch { return 'invalid_topic_key'; } }
  if (raw.kind === 'resolve') {
    if (!targets.includes(raw.winner)) return 'winner_must_be_target';
    if (!['superseded', 'legacy'].includes(raw.loser_state)) return 'loser_state:superseded|legacy';
    if (raw.loser_state === 'legacy' && !text(raw.legacy_reason)) return 'field_required:legacy_reason';
  }
  if (raw.kind === 'legacy' && raw.replaced_by && !(await store.getAtom(String(raw.replaced_by), projectId))) return `target_not_found:${raw.replaced_by}`;
  return { targets, atoms, rationale };
}

export async function fileActions(rawActions, { store, projectId, sessionId, captureSource = 'agent' }) {
  if (!Array.isArray(rawActions) || !rawActions.length) throw new Error('nonempty_actions_required');
  const results = [];
  for (const raw of rawActions) {
    const checked = await validate(raw, { store, projectId });
    if (typeof checked === 'string') { results.push({ kind: raw.kind, error: checked }); continue; }
    const action = { id: randomUUID(), project_id: projectId, kind: raw.kind, targets: checked.targets,
      fields: Object.fromEntries(FIELDS.filter(f => raw[f] !== undefined).map(f => [f, raw[f]])),
      rationale: checked.rationale, evidence_refs: raw.evidence_refs ?? [], capture_source: captureSource,
      session_id: sessionId ?? null, created_at: new Date().toISOString(),
      snapshot: Object.fromEntries(checked.atoms.map(a => [a.id, snapshotOf(a)])), status: 'pending',
      ...(raw.revises ? { revises: String(raw.revises) } : {}) };
    await store.putAction(action);
    // A corrected action answers a revision request: the one it revises leaves the queue.
    const revised = action.revises ? await store.getAction(action.revises) : null;
    if (revised?.project_id === projectId) {
      await store.commitAtoms([], [], [], [{ id: revised.id, value: null }]);
      await store.logAction({ project_id: projectId, action_id: revised.id, kind: revised.kind, targets: revised.targets,
        outcome: 'revised', note: `revised by ${action.id}`, actor_ref: 'agent' });
    }
    results.push({ id: action.id, kind: action.kind, status: 'pending' });
  }
  return results;
}

function requireReview(actor) { if (actor !== HUMAN_REVIEW) throw new Error('human_review_required'); }
const EFFECTIVE = ['active', 'contested'];

// A proposal-shaped result becomes a reviewed memory in the same commit as the
// change that produced it, admitted the way admitMemory admits a candidate.
async function reviewedAtom(raw, { store, projectId, rationale, lifecycleState, extra = {} }) {
  const reasons = checkProposal(raw, projectId);
  if (reasons.length) throw new Error(`cannot_admit:${reasons.join(',')}`);
  const atom = normalizeProposal({ ...raw, project_id: projectId }, projectId, { captureSource: 'agent' });
  const evidence_state = await verifyReferences(atom.evidence_refs, { store, projectId });
  if (evidence_state.artifacts.some(a => a.status === 'out_of_scope')) throw new Error('evidence_scope_violation');
  return stampRevisionFiles({ ...atom, lifecycle_state: lifecycleState, authority: 'validated',
    confidence: cappedConfidence({ ...atom, evidence_state }, { authority: 'validated' }),
    evidence_state: { ...evidence_state, support: 'human_reviewed' },
    review: { source: 'local_ui', reviewed_at: new Date().toISOString(), rationale }, ...extra }, store);
}

async function topicFree(store, projectId, topic, allowed) {
  const holder = (await store.listByTopicLive(projectId, topic))[0];
  if (holder && !allowed.includes(holder.id)) throw new Error('topic_key_taken');
}

// Each builder returns everything one commit writes. Nothing is written until
// all of it is known, so a refusal anywhere leaves the store as it was.
const BUILD = {
  async archive({ atoms, fields, now }) {
    return { atoms: atoms.map(a => ({ ...a, lifecycle_state: 'archived', archived_at: now,
      archived_reason: text(fields.archived_reason), contested_at: null })) };
  },
  async restore({ atoms, store, projectId }) {
    for (const a of atoms) await topicFree(store, projectId, a.topic_key, [a.id]);
    return { atoms: atoms.map(a => ({ ...a, lifecycle_state: 'active', archived_at: null, archived_reason: null,
      legacy_reason: null, legacy_at: null, replaced_by: null })) };
  },
  async delete({ atoms }) { return { atoms: [], deleteAtoms: atoms }; },
  async legacy({ atoms, fields, now }) {
    return { atoms: atoms.map(a => ({ ...a, lifecycle_state: 'legacy', legacy_reason: text(fields.legacy_reason), legacy_at: now,
      replaced_by: fields.replaced_by ?? a.superseded_by ?? null, contested_at: null })) };
  },
  async merge({ atoms, fields, store, projectId, rationale, now }) {
    const allLegacy = atoms.every(a => a.lifecycle_state === 'legacy');
    await topicFree(store, projectId, fields.result.topic_key, atoms.map(a => a.id));
    const result = await reviewedAtom(fields.result, { store, projectId, rationale, lifecycleState: allLegacy ? 'legacy' : 'active',
      extra: allLegacy ? { legacy_reason: text(fields.legacy_reason), legacy_at: now } : {} });
    // Each source moves one step down: current knowledge becomes history, and
    // history or abandoned practice leaves for the archive.
    const moved = atoms.map(a => EFFECTIVE.includes(a.lifecycle_state)
      ? { ...a, lifecycle_state: 'superseded', superseded_by: result.id, contested_at: null }
      : { ...a, lifecycle_state: 'archived', archived_at: now, archived_reason: `merged into ${result.id}` });
    return { atoms: [...moved, result], relations: atoms.filter(a => EFFECTIVE.includes(a.lifecycle_state))
      .map(a => ({ source_atom_id: result.id, relation_type: 'supersedes', target_atom_id: a.id })) };
  },
  async split({ atoms: [source], fields, store, projectId, rationale }) {
    const results = [];
    for (const raw of fields.results) {
      await topicFree(store, projectId, raw.topic_key, [source.id]);
      results.push(await reviewedAtom(raw, { store, projectId, rationale, lifecycleState: 'active' }));
    }
    return { atoms: [{ ...source, lifecycle_state: 'superseded', superseded_by: results[0].id, contested_at: null }, ...results],
      relations: results.map(r => ({ source_atom_id: r.id, relation_type: 'supersedes', target_atom_id: source.id })) };
  },
  async retopic({ atoms: [source], fields, store, projectId, rationale }) {
    await topicFree(store, projectId, fields.topic_key, []);
    // Moving a memory does not re-judge what it says: it keeps its content,
    // authority and evidence under a new id on the new topic.
    const moved = { ...source, id: randomUUID(), topic_key: fields.topic_key, registry_key_id: null, created_at: undefined,
      review: { source: 'local_ui', reviewed_at: new Date().toISOString(), rationale } };
    return { atoms: [{ ...source, lifecycle_state: 'superseded', superseded_by: moved.id, contested_at: null }, moved],
      relations: [{ source_atom_id: moved.id, relation_type: 'supersedes', target_atom_id: source.id }] };
  },
  async resolve({ fields, targets, store, projectId, rationale, now }) {
    const loser = targets.find(t => t !== fields.winner);
    const atoms = await planResolution(fields.winner, loser, { store, projectId, rationale });
    if (fields.loser_state === 'legacy') {
      const index = atoms.findIndex(a => a.id === loser);
      atoms[index] = { ...atoms[index], lifecycle_state: 'legacy', legacy_reason: text(fields.legacy_reason),
        legacy_at: now, replaced_by: fields.winner };
    }
    return { atoms };
  },
};

export async function applyAction(id, { store, projectId, actor, rationale } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const action = await store.getAction(id);
    if (!action || action.project_id !== projectId) throw new Error('action_not_found');
    if (action.revision_requested) throw new Error('revision_requested');
    const atoms = await Promise.all(action.targets.map(t => store.getAtom(t, projectId)));
    const replacementGone = action.kind === 'legacy' && action.fields.replaced_by
      && !EFFECTIVE.includes((await store.getAtom(action.fields.replaced_by, projectId))?.lifecycle_state);
    if (atoms.some((a, i) => !a || snapshotOf(a) !== action.snapshot[action.targets[i]]) || replacementGone) {
      await store.putAction({ ...action, status: 'stale' });
      await store.logAction({ project_id: projectId, action_id: id, kind: action.kind, targets: action.targets,
        outcome: 'stale', actor_ref: 'local_ui' });
      throw new Error('action_stale');
    }
    const built = await BUILD[action.kind]({ atoms, targets: action.targets, fields: action.fields, store, projectId,
      rationale: text(rationale) || 'Applied in the audit UI.', now: new Date().toISOString() });
    await store.commitAtoms(built.atoms, built.relations ?? [], built.deleteAtoms ?? [], [{ id, value: null }]);
    if (action.kind === 'resolve') {
      await store.logContradiction({ project_id: projectId, atom_a_id: action.fields.winner,
        atom_b_id: action.targets.find(t => t !== action.fields.winner), detection_source: 'explicit', action: 'resolved',
        winner_atom_id: action.fields.winner, reasons: ['human_reviewed'] });
    }
    await store.logAction({ project_id: projectId, action_id: id, kind: action.kind, targets: action.targets,
      outcome: 'applied', actor_ref: 'local_ui' });
    return { applied: true, kind: action.kind, changed: action.targets };
  });
}

export async function rejectAction(id, { store, projectId, actor, note } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const action = await store.getAction(id);
    if (!action || action.project_id !== projectId) throw new Error('action_not_found');
    await store.commitAtoms([], [], [], [{ id, value: null }]);
    await store.logAction({ project_id: projectId, action_id: id, kind: action.kind, targets: action.targets,
      outcome: 'rejected', note: text(note) || null, actor_ref: 'local_ui' });
    return { rejected: true };
  });
}
