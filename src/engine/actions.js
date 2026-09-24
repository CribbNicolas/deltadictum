import { randomUUID } from 'node:crypto';
import { normalizeProposal, validateContract } from './contract.js';
import { decideAdmission } from './v2/admission.js';
import { looksNonEnglish } from './language.js';
import { sanitizeText } from './v2/sanitizer.js';
import { assertTopicKeyPath } from '../store/paths.js';

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
    results.push({ id: action.id, kind: action.kind, status: 'pending' });
  }
  return results;
}
