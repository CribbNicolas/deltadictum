import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
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
// The project id a new memory carries, as ingestion picks it (src/capture/inbox.js):
// .dd/config.json, then the existing memories, then the folder's name.
async function projectIdOf(root) {
  let configured = null;
  try { configured = JSON.parse(readFileSync(join(localPaths(root).dd, 'config.json'), 'utf8')).project_id; } catch { /* no config */ }
  if (typeof configured === 'string' && configured.trim()) return configured;
  return (await storeOf(root).list())[0]?.project_id ?? basename(root);
}
// A person who edits, restores or re-topics a live memory has reviewed it:
// retirement by disuse spares what a person reviewed (src/maintenance/retire.js).
const reviewedByPerson = (memory, at) => (LIVE_STATUSES.includes(memory.status)
  ? { ...memory, review: { ...memory.review, accepted: { by: 'person', at } } } : memory);
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
  const at = now();
  const next = reviewedByPerson({ ...memory, ...changes, origin: 'user_explicit', updated: at }, at);
  if (changes.check === null) delete next.check;
  // A migrated memory waits for a person to say why the code does not show it
  // (spec section 9). Once one does, its v2 review is done and v2's rules apply.
  if (next.review?.migrated && String(next.not_derivable ?? '').trim()) {
    next.review = { ...next.review, migrated: false, issues: (next.review.issues ?? []).filter(issue => issue !== 'not_derivable_missing') };
  }
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
  const at = now();
  const restored = { ...memory, status: 'active', updated: at,
    review: { ...memory.review, issues: (memory.review?.issues ?? []).filter(issue => issue !== 'retired_by_disuse') } };
  const next = reviewedByPerson(restored, at);
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
  const memory = { schema_version: SCHEMA_VERSION, id: randomUUID(), project_id: await projectIdOf(root),
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
  // The kept memory carries the merged knowledge on: one that is not live would drop it.
  if (!LIVE_STATUSES.includes(keep.status) && keep.status !== 'candidate') throw new ReviewError([`merge_into_${keep.status}`]);
  const issues = [...new Set([...(drop.review?.issues ?? []), `merged_into:${keep.id}`])];
  await save(root, [{ ...drop, status: 'archived', updated: now(), review: { ...drop.review, issues } }]);
  return keep;
}

export async function retopicMemory(root, id, topic) {
  const memory = await find(root, id);
  const at = now();
  const next = reviewedByPerson({ ...memory, topic, updated: at }, at);
  const problems = validateMemory(next);
  if (problems.length) throw new ReviewError(problems);
  return save(root, [next]);
}
