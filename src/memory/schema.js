import { compilePattern } from '../checks/pattern.cjs';
import { DIMENSIONS, EVENT_KINDS } from '../engine/clause.cjs';
import { containsSecret, hasUnsafeMemoryContent } from '../engine/v2/sanitizer.js';
import { BODY_MAX } from './convert-v1.js';

// Schema 8: a memory is a rule with triggers. validateMemory names every problem;
// nothing is defaulted or repaired here.
export const SCHEMA_VERSION = 8;
export const KINDS = ['decision', 'trap', 'failed_approach', 'fact', 'procedure'];
export const STATUSES = ['candidate', 'active', 'contested', 'superseded', 'archived'];
export const LIVE_STATUSES = ['active', 'contested'];
export const ORIGINS = ['model_initiated', 'user_explicit'];
export const EVIDENCE_TYPES = ['file', 'observation', 'correction', 'note'];
// keywords and not allow 16 because v1 anchors did: a migrated store must still validate.
export const LIMITS = { body: BODY_MAX, title: 200, not_derivable: 300, file: 16000, list: 12, keywords: 16,
  phrase: 100, glob: 200, say: 200, summary: 500 };

const FIELDS = ['schema_version', 'id', 'project_id', 'topic', 'kind', 'status', 'title', 'body', 'not_derivable',
  'triggers', 'check', 'evidence', 'origin', 'replaces', 'revisit_when', 'review', 'created', 'updated'];
const CLAUSE_FIELDS = ['on', ...DIMENSIONS, 'not', 'not_paths'];
const CHECK_FIELDS = ['on', 'paths', 'when', 'if_content', 'unless_content', 'if_command', 'unless_command', 'say', 'examples'];
const CHECK_EVENTS = ['edit', 'write', 'run'];
const CHECK_WHEN = ['turn', 'edit', 'run'];
const REVISION_KINDS = ['manual', 'file_changed', 'fact_changed', 'date'];

const ID = /^[a-zA-Z0-9_-]{1,64}$/;
const SEGMENT = /^[a-z0-9_-]+$/;
const SYMBOL = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isText = value => typeof value === 'string' && value.trim().length > 0;
const isDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const isStringList = value => Array.isArray(value) && value.every(isText);

export function validTopic(topic) {
  const parts = String(topic ?? '').split('/');
  return parts.length >= 2 && parts.length <= 4 && parts.every(part => SEGMENT.test(part));
}

// A repository-relative path or glob: no absolute path, drive or parent segment,
// and at most three `**`: each one more multiplies the work of matching a path
// the glob misses, on every tool call.
export const validRelativePath = path => typeof path === 'string' && path.length > 0 && path.length <= LIMITS.glob
  && !path.startsWith('/') && !path.includes(':') && !path.replaceAll('\\', '/').split('/').includes('..')
  && (path.match(/\*\*/g) ?? []).length <= 3;

function clauseProblems(clause) {
  if (!isObject(clause)) return ['invalid_trigger'];
  const problems = [];
  if (Object.keys(clause).some(key => !CLAUSE_FIELDS.includes(key))) problems.push('unknown_trigger_field');
  if (!Array.isArray(clause.on) || !clause.on.length || !clause.on.every(kind => EVENT_KINDS.includes(kind))) problems.push('invalid_trigger_on');
  if (!DIMENSIONS.some(dimension => Array.isArray(clause[dimension]) && clause[dimension].length)) problems.push('trigger_without_dimension');
  for (const key of [...DIMENSIONS, 'not', 'not_paths']) {
    if (clause[key] === undefined) continue;
    if (!isStringList(clause[key])) { problems.push('invalid_trigger_entry'); continue; }
    if (clause[key].length > (key === 'keywords' || key === 'not' ? LIMITS.keywords : LIMITS.list)) problems.push('too_many_trigger_entries');
  }
  if (isStringList(clause.paths) && !clause.paths.every(validRelativePath)) problems.push('invalid_trigger_glob');
  if (isStringList(clause.symbols) && !clause.symbols.every(symbol => SYMBOL.test(symbol))) problems.push('invalid_trigger_symbol');
  for (const key of ['commands', 'keywords']) {
    if (isStringList(clause[key]) && clause[key].some(phrase => phrase.length > LIMITS.phrase)) problems.push('invalid_trigger_phrase');
  }
  if ((isStringList(clause.not) && clause.not.some(phrase => phrase.length > LIMITS.phrase))
    || (isStringList(clause.not_paths) && !clause.not_paths.every(validRelativePath))) problems.push('invalid_trigger_not');
  return problems;
}

function checkProblems(check) {
  if (!isObject(check)) return ['invalid_check'];
  const problems = [];
  if (Object.keys(check).some(key => !CHECK_FIELDS.includes(key))) problems.push('unknown_check_field');
  const on = Array.isArray(check.on) ? check.on : [];
  if (!on.length || !on.every(kind => CHECK_EVENTS.includes(kind))) problems.push('invalid_check_on');
  const onFiles = on.includes('edit') || on.includes('write');
  if (onFiles && !(isStringList(check.paths) && check.paths.length && check.paths.every(validRelativePath))) problems.push('check_paths_required');
  if (onFiles && !compilePattern(check.if_content)) problems.push('invalid_check_pattern');
  if (on.includes('run') && !compilePattern(check.if_command)) problems.push('invalid_check_pattern');
  for (const key of ['unless_content', 'unless_command']) {
    if (check[key] !== undefined && !compilePattern(check[key])) problems.push('invalid_check_pattern');
  }
  if (check.when !== undefined && !CHECK_WHEN.includes(check.when)) problems.push('invalid_check_when');
  if (!isText(check.say) || check.say.length > LIMITS.say) problems.push('invalid_check_say');
  if (typeof check.examples?.violates !== 'string' || typeof check.examples?.passes !== 'string') problems.push('check_examples_required');
  return problems;
}

function evidenceProblems(entry) {
  if (!isObject(entry) || !EVIDENCE_TYPES.includes(entry.type)) return ['invalid_evidence_type'];
  const problems = [];
  if (entry.type === 'file' && !validRelativePath(entry.path)) problems.push('invalid_evidence_path');
  if (entry.sha256 !== undefined && !SHA256.test(String(entry.sha256))) problems.push('invalid_evidence_hash');
  if (typeof entry.summary !== 'string' || entry.summary.length > LIMITS.summary) problems.push('invalid_evidence_summary');
  return problems;
}

function revisionProblems(rule) {
  if (!isObject(rule) || !REVISION_KINDS.includes(rule.kind) || !isText(rule.description)) return ['invalid_revision_condition'];
  if (rule.kind === 'file_changed' && !validRelativePath(rule.path)) return ['revision_path_required'];
  if (rule.kind === 'fact_changed' && (!rule.key || rule.equals === undefined)) return ['revision_fact_required'];
  if (rule.kind === 'date' && !isDate(rule.date)) return ['invalid_revision_date'];
  return [];
}

export function validateMemory(memory) {
  if (!isObject(memory)) return ['invalid_memory'];
  const reasons = [];
  const migrated = memory.review?.migrated === true;
  const live = LIVE_STATUSES.includes(memory.status);
  for (const key of Object.keys(memory)) if (!FIELDS.includes(key)) reasons.push(`unknown_field:${key}`);
  if (memory.schema_version !== SCHEMA_VERSION) reasons.push('invalid_schema_version');
  if (!ID.test(String(memory.id ?? ''))) reasons.push('invalid_id');
  if (!isText(memory.project_id)) reasons.push('missing_project_id');
  if (!validTopic(memory.topic)) reasons.push('invalid_topic');
  if (!KINDS.includes(memory.kind)) reasons.push('invalid_kind');
  if (!STATUSES.includes(memory.status)) reasons.push('invalid_status');
  if (!ORIGINS.includes(memory.origin)) reasons.push('invalid_origin');
  if (!isText(memory.title)) reasons.push('missing_title');
  else if (memory.title.length > LIMITS.title) reasons.push('title_too_long');
  if (!isText(memory.body)) reasons.push('missing_body');
  else if (memory.body.length > LIMITS.body && !migrated) reasons.push('body_too_long');
  if (typeof memory.not_derivable !== 'string') reasons.push('invalid_not_derivable');
  else if (memory.not_derivable.length > LIMITS.not_derivable) reasons.push('not_derivable_too_long');
  else if (live && !migrated && !memory.not_derivable.trim()) reasons.push('not_derivable_required');
  if (!Array.isArray(memory.triggers)) reasons.push('invalid_triggers');
  else {
    if (memory.triggers.length > LIMITS.list) reasons.push('too_many_triggers');
    if (live && !memory.triggers.length) reasons.push('triggers_required');
    for (const clause of memory.triggers) reasons.push(...clauseProblems(clause));
  }
  if (memory.check !== undefined) reasons.push(...checkProblems(memory.check));
  if (!Array.isArray(memory.evidence) || memory.evidence.length > LIMITS.list) reasons.push('invalid_evidence');
  else for (const entry of memory.evidence) reasons.push(...evidenceProblems(entry));
  if (!Array.isArray(memory.revisit_when) || memory.revisit_when.length > LIMITS.list) reasons.push('invalid_revisit_when');
  else for (const rule of memory.revisit_when) reasons.push(...revisionProblems(rule));
  if (memory.replaces !== null && memory.replaces !== undefined && !ID.test(String(memory.replaces))) reasons.push('invalid_replaces');
  if (memory.review !== undefined && (!isObject(memory.review) || (memory.review.issues !== undefined && !Array.isArray(memory.review.issues)))) {
    reasons.push('invalid_review');
  }
  if (!isDate(memory.created) || !isDate(memory.updated)) reasons.push('invalid_dates');
  const serialized = JSON.stringify(memory);
  if (serialized.length > LIMITS.file) reasons.push('memory_too_large');
  if (hasUnsafeMemoryContent(serialized)) reasons.push('unsafe_memory_content');
  if (containsSecret(serialized)) reasons.push('contains_secret');
  return [...new Set(reasons)];
}

const ordered = (object, keys) => Object.fromEntries(keys.filter(key => object[key] !== undefined).map(key => [key, object[key]]));

// The memory with its keys, its clauses' keys and its check's keys in one fixed
// order, so the same memory always serializes to the same bytes.
export function orderMemory(memory) {
  const result = ordered(memory, FIELDS);
  if (Array.isArray(result.triggers)) result.triggers = result.triggers.map(clause => (isObject(clause) ? ordered(clause, CLAUSE_FIELDS) : clause));
  if (isObject(result.check)) result.check = ordered(result.check, CHECK_FIELDS);
  return result;
}

export const serializeMemory = memory => `${JSON.stringify(orderMemory(memory), null, 2)}\n`;
