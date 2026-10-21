import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { exampleProblems } from '../checks/check.cjs';
import { createMatcher } from '../checks/pattern.cjs';
import { codeSymbols, compileProject, presentFilesOf, triggerWarnings } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { LIVE_STATUSES, SCHEMA_VERSION, validateMemory } from '../memory/schema.js';
import { listBatches } from './batches.js';
import { closeRequest, listRequests } from './requests.js';
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
    const repoFiles = presentFilesOf(root);
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

// A memory DD accepted on its own, seen by a person and left as it is: the review
// it waited for, so it leaves the auto_accepted queue and retirement spares it.
// Stale evidence re-anchored by a person: each file entry that still exists is
// hashed again at its current content; a file that is gone stays stale and is
// reported. Integrity only (invariants): the person judged the claim, DD did not.
export async function reverifyEvidence(root, id) {
  const memory = await find(root, id);
  if (!LIVE_STATUSES.includes(memory.status)) throw new ReviewError(['not_live']);
  const stale = [];
  const evidence = memory.evidence.map(entry => {
    if (entry.type !== 'file' || !entry.sha256) return entry;
    try { return { ...entry, sha256: createHash('sha256').update(readFileSync(join(root, entry.path))).digest('hex') }; }
    catch { stale.push(entry.path); return entry; }
  });
  const at = now();
  const saved = await save(root, [reviewedByPerson({ ...memory, evidence, updated: at }, at)]);
  return { memory: saved, stale };
}

// The agent's requests a person can carry out as asked. A revise request is not one:
// what to change is the person's to write.
const APPLIED = ['archive', 'merge', 'reverify', 'delete'];
const targetsOf = request => (Array.isArray(request.targets) ? request.targets : [request.target]).filter(target => typeof target === 'string');

// The live memory that replaced `id` by revision, through any revisions between them:
// a request written before another batch revised its target acts on the revision.
function revisionOf(memories, id) {
  const seen = new Set();
  let current = id;
  while (!seen.has(current)) {
    seen.add(current);
    const next = memories.find(memory => memory.replaces === current && memory.status !== 'candidate' && memory.status !== 'archived');
    if (!next) return null;
    if (LIVE_STATUSES.includes(next.status)) return next;
    current = next.id;
  }
  return null;
}

// One request, carried out on each memory it names (an id, or the topic of a live
// memory; deletion takes ids only, of memories no longer live: a live one is archived
// first, so the file is kept). Closed once anything was done; what could not be done
// is reported, and a request that did nothing stays open for the person.
async function carryOut(root, request) {
  const done = [];
  const refused = [];
  for (const target of targetsOf(request)) {
    try {
      const memories = await storeOf(root).list();
      const live = memories.filter(memory => LIVE_STATUSES.includes(memory.status));
      const named = request.request === 'delete' ? memories.find(memory => memory.id === target)
        : live.find(memory => memory.id === target) ?? live.find(memory => memory.topic === target) ?? revisionOf(memories, target);
      if (!named) throw new ReviewError([request.request === 'delete' ? 'memory_not_found' : 'target_not_live']);
      if (request.request === 'archive') await archiveMemory(root, named.id, request.why);
      if (request.request === 'reverify') await reverifyEvidence(root, named.id);
      if (request.request === 'merge') {
        const into = memories.find(memory => memory.id === request.into && memory.status !== 'superseded')
          ?? live.find(memory => memory.topic === request.into);
        if (!into) throw new ReviewError(['into_not_live']);
        await mergeMemories(root, into.id, named.id);
      }
      if (request.request === 'delete') {
        if (LIVE_STATUSES.includes(named.status) || named.status === 'candidate') throw new ReviewError([`delete_live:${named.id}`]);
        await deleteMemory(root, named.id);
      }
      done.push(named.id);
    } catch (err) {
      if (!(err instanceof ReviewError)) throw err;
      refused.push({ id: request.id, target, problems: err.problems });
    }
  }
  if (done.length) closeRequest(root, request.id, 'done');
  return { done, refused };
}

// A request no batch names, carried out by a person from the review UI.
export async function applyRequest(root, id) {
  const request = listRequests(root).find(open => open.id === id);
  if (!request) throw new ReviewError(['request_not_found']);
  if (!APPLIED.includes(request.request)) throw new ReviewError(['needs_a_person']);
  return carryOut(root, request);
}

// A batch, accepted or rejected whole by a person. Each candidate goes through the
// same acceptance as alone, so one that is refused (a dead trigger, say) is reported
// and the rest proceed. Then its requests are carried out, archives, merges and
// re-verifications before deletions, so a merge can name a topic the batch just
// revised and a deletion can take what the batch just archived; a revise request,
// or one that could do nothing, is left for a person.
export async function batchAction(root, name, outcome) {
  if (!['accept', 'reject'].includes(outcome)) throw new ReviewError(['invalid_outcome']);
  const batch = (await listBatches(root)).find(b => b.name === name);
  if (!batch) throw new ReviewError(['batch_not_found']);
  const result = { name, outcome, accepted: [], rejected: [], refused: [], closed: [], left: [] };
  for (const { id } of batch.candidates) {
    try {
      if (outcome === 'accept') { await acceptMemory(root, id); result.accepted.push(id); }
      else { await rejectMemory(root, id, `batch ${name} rejected`); result.rejected.push(id); }
    } catch (err) {
      if (!(err instanceof ReviewError)) throw err;
      result.refused.push({ id, problems: err.problems });
    }
  }
  const order = request => (request.request === 'delete' ? 1 : 0);
  for (const request of [...batch.requests].sort((a, b) => order(a) - order(b))) {
    if (outcome === 'reject') { closeRequest(root, request.id, 'dismissed'); result.closed.push(request.id); continue; }
    if (!APPLIED.includes(request.request)) { result.left.push({ id: request.id, reason: 'needs_a_person' }); continue; }
    const { done, refused } = await carryOut(root, request);
    if (done.length) result.closed.push(request.id);
    else result.left.push({ id: request.id, reason: refused[0]?.problems[0] ?? 'nothing_to_do' });
    result.refused.push(...refused);
  }
  return result;
}

export async function markReviewed(root, id) {
  const memory = await find(root, id);
  if (!LIVE_STATUSES.includes(memory.status)) throw new ReviewError(['not_live']);
  const at = now();
  return save(root, [reviewedByPerson({ ...memory, updated: at }, at)]);
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
    review: { issues: [], accepted: { by: 'person', at } }, created: at, updated: at };
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
