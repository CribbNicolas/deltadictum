import { randomUUID } from 'node:crypto';
import { exampleProblems } from '../checks/check.cjs';
import { createMatcher } from '../checks/pattern.cjs';
import { codeSymbols, compileProject, repoFilesOf, triggerWarnings } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { LIVE_STATUSES, SCHEMA_VERSION, validateMemory } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';

// What a person does in the review UI (spec section 8). Every action validates as
// ingestion does, writes through the store and recompiles. A person's edit is
// user_explicit; a person's acceptance is recorded as such.
export class ReviewError extends Error {
  constructor(problems) {
    super(problems.join(', '));
    this.problems = problems;
  }
}

const EDITABLE = ['title', 'body', 'kind', 'not_derivable', 'triggers', 'check', 'revisit_when'];
const now = () => new Date().toISOString();
const storeOf = root => createMemoryFiles(localPaths(root).dd);

function problemsOf(root, memory) {
  const problems = validateMemory(memory);
  if (memory.check) problems.push(...exampleProblems(memory.check, createMatcher()));
  if (LIVE_STATUSES.includes(memory.status)) {
    const repoFiles = repoFilesOf(root);
    if (repoFiles) {
      const found = codeSymbols(root, [...new Set(memory.triggers.flatMap(clause => clause.symbols ?? []))]);
      for (const warning of triggerWarnings(memory, repoFiles, found ? symbol => found.has(symbol) : null)) {
        if (warning.kind.startsWith('dead_')) problems.push(`${warning.kind}:${warning.value}`);
      }
    }
  }
  return [...new Set(problems)];
}

async function save(root, put, remove = []) {
  try { await storeOf(root).commit({ put, remove }); }
  catch (err) { throw new ReviewError([String(err.message).split(':').slice(0, 2).join(':')]); }
  await compileProject(root);
  return put[0] ?? null;
}

async function find(root, id) {
  const memory = await storeOf(root).get(id);
  if (!memory) throw new ReviewError(['memory_not_found']);
  return memory;
}

export async function editMemory(root, id, changes) {
  const memory = await find(root, id);
  const refused = Object.keys(changes ?? {}).filter(key => !EDITABLE.includes(key));
  if (refused.length) throw new ReviewError(refused.map(key => `not_editable:${key}`));
  const next = { ...memory, ...changes, origin: 'user_explicit', updated: now() };
  if (changes.check === null) delete next.check;
  const problems = problemsOf(root, next);
  if (problems.length) throw new ReviewError(problems);
  return save(root, [next]);
}

export async function acceptMemory(root, id) {
  const memory = await find(root, id);
  if (memory.status !== 'candidate') throw new ReviewError(['not_a_candidate']);
  const at = now();
  const next = { ...memory, status: 'active', updated: at, review: { ...memory.review, accepted: { by: 'person', at } } };
  const problems = problemsOf(root, next);
  if (problems.length) throw new ReviewError(problems);
  const replaced = memory.replaces ? await storeOf(root).get(memory.replaces) : null;
  const put = [next];
  if (replaced && LIVE_STATUSES.includes(replaced.status)) put.push({ ...replaced, status: 'superseded', updated: at });
  return save(root, put);
}

async function retire(root, id, from, issue) {
  const memory = await find(root, id);
  if (!from.includes(memory.status)) throw new ReviewError([`cannot_archive_${memory.status}`]);
  const issues = [...new Set([...(memory.review?.issues ?? []), issue])];
  return save(root, [{ ...memory, status: 'archived', updated: now(), review: { ...memory.review, issues } }]);
}

const because = (code, reason) => (reason ? `${code}: ${String(reason).slice(0, 200)}` : code);
export const rejectMemory = (root, id, reason = '') => retire(root, id, ['candidate'], because('rejected_by_person', reason));
export const archiveMemory = (root, id, reason = '') => retire(root, id, ['active', 'contested'], because('archived_by_person', reason));

export async function restoreMemory(root, id) {
  const memory = await find(root, id);
  if (memory.status !== 'archived') throw new ReviewError(['not_archived']);
  const live = (await storeOf(root).list({ statuses: LIVE_STATUSES })).find(other => other.topic === memory.topic);
  if (live) throw new ReviewError([`topic_is_live:${memory.topic}`]);
  const next = { ...memory, status: 'active', updated: now() };
  const problems = problemsOf(root, next);
  if (problems.length) throw new ReviewError(problems);
  return save(root, [next]);
}

export async function deleteMemory(root, id) {
  await find(root, id);
  await save(root, [], [id]);
  return id;
}

export async function createMemory(root, fields = {}) {
  const at = now();
  const memory = { schema_version: SCHEMA_VERSION, id: randomUUID(), project_id: (await storeOf(root).list())[0]?.project_id ?? 'project',
    topic: fields.topic, kind: fields.kind, status: 'active', title: fields.title, body: fields.body,
    not_derivable: String(fields.not_derivable ?? '').trim(), triggers: fields.triggers ?? [], ...(fields.check ? { check: fields.check } : {}),
    evidence: fields.evidence ?? [], origin: 'user_explicit', replaces: null, revisit_when: [],
    review: { migrated: false, issues: [], accepted: { by: 'person', at } }, created: at, updated: at };
  const problems = problemsOf(root, memory);
  if (problems.length) throw new ReviewError(problems);
  return save(root, [memory]);
}

export async function mergeMemories(root, keepId, dropId) {
  const keep = await find(root, keepId);
  const drop = await find(root, dropId);
  if (keep.id === drop.id) throw new ReviewError(['merge_into_itself']);
  const issues = [...new Set([...(drop.review?.issues ?? []), `merged_into:${keep.id}`])];
  await save(root, [{ ...drop, status: 'archived', updated: now(), review: { ...drop.review, issues } }]);
  return keep;
}

export async function retopicMemory(root, id, topic) {
  const memory = await find(root, id);
  const next = { ...memory, topic, updated: now() };
  const problems = validateMemory(next);
  if (problems.length) throw new ReviewError(problems);
  return save(root, [next]);
}
