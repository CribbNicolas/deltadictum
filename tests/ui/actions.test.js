import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { acceptMemory, archiveMemory, createMemory, deleteMemory, editMemory, markReviewed, mergeMemories, rejectMemory, restoreMemory, retopicMemory, reverifyEvidence, ReviewError } from '../../src/ui/actions.js';
import { loadIndex } from '../../src/engine/index-file.cjs';
import { createMemoryFiles } from '../../src/memory/store.js';
import { memory, project } from '../helpers/review.js';

const list = async root => Object.fromEntries((await createMemoryFiles(join(root, '.dd')).list()).map(m => [m.id, m]));

test('an edit by a person is validated, marks the origin and recompiles', async t => {
  const root = await project(t, [memory('m1')]);
  const edited = await editMemory(root, 'm1', { body: 'Close the store in `t.after`, always.' });
  assert.equal(edited.origin, 'user_explicit');
  assert.ok(loadIndex(root).memories.m1);
  await assert.rejects(editMemory(root, 'm1', { not_derivable: '' }), err => err instanceof ReviewError && err.problems.includes('not_derivable_required'));
  await assert.rejects(editMemory(root, 'm1', { triggers: [{ on: ['edit'], paths: ['docs/none.md'] }] }), err => err.problems.includes('dead_glob:docs/none.md'));
  await assert.rejects(editMemory(root, 'm1', { id: 'x', status: 'archived' }), err => err.problems.includes('not_editable:id'));
});

test('a person supplying not_derivable completes a migrated memory\'s review, and its exemption ends', async t => {
  const migrated = memory('m1', { not_derivable: '', review: { migrated: true, issues: ['not_derivable_missing', 'folder_scope'] } });
  const root = await project(t, [migrated]);
  const reviewed = await editMemory(root, 'm1', { not_derivable: 'Hidden from the code.' });
  assert.equal(reviewed.review.migrated, false);
  assert.deepEqual(reviewed.review.issues, ['folder_scope']);
  await assert.rejects(editMemory(root, 'm1', { not_derivable: '' }), err => err.problems.includes('not_derivable_required'));
  // An edit that leaves not_derivable empty is not that review: the memory stays migrated and queued.
  const other = await project(t, [migrated]);
  assert.equal((await editMemory(other, 'm1', { title: 'Renamed' })).review.migrated, true);
});

test('accepting a revision supersedes what it replaces, in one commit', async t => {
  const root = await project(t, [memory('old'), memory('new', { topic: 'ui/old', status: 'candidate', replaces: 'old' })]);
  await acceptMemory(root, 'new');
  const after = await list(root);
  assert.equal(after.new.status, 'active');
  assert.equal(after.new.review.accepted.by, 'person');
  assert.equal(after.old.status, 'superseded');
  await assert.rejects(acceptMemory(root, 'old'), err => err.problems.includes('not_a_candidate'));
});

test('reject, archive, restore and delete; a restore onto a live topic is refused', async t => {
  const root = await project(t, [memory('c', { status: 'candidate' }), memory('a'), memory('b', { topic: 'ui/b' })]);
  assert.equal((await rejectMemory(root, 'c', 'Not specific.')).status, 'archived');
  assert.equal((await archiveMemory(root, 'a', 'Obsolete.')).status, 'archived');
  assert.equal((await restoreMemory(root, 'a')).status, 'active');
  await archiveMemory(root, 'a', 'Again.');
  await createMemory(root, { topic: 'ui/a', kind: 'trap', title: 'Replacement', body: 'Use `aThing` in src/a.js.', not_derivable: 'Hidden from the code.',
    triggers: [{ on: ['edit'], paths: ['src/a.js'] }] });
  await assert.rejects(restoreMemory(root, 'a'), err => err.problems.includes('topic_is_live:ui/a'));
  await deleteMemory(root, 'b');
  assert.equal((await list(root)).b, undefined);
});

test('a memory a person writes is active and accepted by a person; merge and re-topic keep one live memory per topic', async t => {
  const root = await project(t, [memory('keep'), memory('drop', { topic: 'ui/drop' })]);
  const made = await createMemory(root, { topic: 'ui/new', kind: 'fact', title: 'New', body: 'Ports below 1024 need admin on src/a.js servers.',
    not_derivable: 'Hidden from the code.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }] });
  assert.equal(made.status, 'active');
  assert.equal(made.origin, 'user_explicit');
  assert.equal(made.review.accepted.by, 'person');
  await mergeMemories(root, 'keep', 'drop');
  const after = await list(root);
  assert.equal(after.drop.status, 'archived');
  assert.ok(after.drop.review.issues.includes('merged_into:keep'));
  assert.equal((await retopicMemory(root, 'keep', 'ui/kept')).topic, 'ui/kept');
  await assert.rejects(retopicMemory(root, 'keep', 'ui/new'), err => err.problems.some(p => p.startsWith('live_topic_conflict')));
});

// Retirement by disuse spares only what a person reviewed (review.accepted.by):
// a restore, an edit or a re-topic of a live memory is that review, or the next
// maintenance run archives the memory again.
test('restoring, editing or re-topicking a live memory records the person, so retirement spares it', async t => {
  const retired = memory('r1', { status: 'archived', review: { migrated: false, issues: ['retired_by_disuse'], accepted: { by: 'dd', at: '2026-09-01T00:00:00.000Z' } } });
  const root = await project(t, [retired, memory('e1', { topic: 'ui/e1' })]);
  const restored = await restoreMemory(root, 'r1');
  assert.equal(restored.review.accepted.by, 'person');
  assert.deepEqual(restored.review.issues, []);
  assert.equal((await editMemory(root, 'e1', { title: 'Renamed rule' })).review.accepted.by, 'person');
  assert.equal((await retopicMemory(root, 'r1', 'ui/r1-moved')).review.accepted.by, 'person');
  const candidate = await project(t, [memory('c1', { status: 'candidate' })]);
  assert.equal((await editMemory(candidate, 'c1', { title: 'Still a candidate' })).review.accepted, undefined);
});

// Auto-accept activates a memory without a person. What DD accepted stays
// reviewable: a person marks one as seen without changing it, and retirement then
// spares it like any memory a person reviewed.
test('a memory DD accepted can be marked as reviewed by a person, unchanged; a candidate cannot', async t => {
  const root = await project(t, [memory('auto', { review: { migrated: false, issues: [], accepted: { by: 'dd', at: '2026-10-14T00:00:00.000Z' } } }),
    memory('c1', { topic: 'ui/c1', status: 'candidate' })]);
  const seen = await markReviewed(root, 'auto');
  assert.equal(seen.review.accepted.by, 'person');
  assert.equal(seen.body, 'Close the store in t.after (auto).');
  assert.equal(seen.origin, 'model_initiated');
  await assert.rejects(markReviewed(root, 'c1'), err => err instanceof ReviewError && err.problems.includes('not_live'));
});

test('a merge into a memory that is not live is refused: the merged knowledge would stop being delivered', async t => {
  const root = await project(t, [memory('old', { status: 'archived' }), memory('drop', { topic: 'ui/drop' })]);
  await assert.rejects(mergeMemories(root, 'old', 'drop'), err => err.problems.includes('merge_into_archived'));
  assert.equal((await list(root)).drop.status, 'active');
});

test('a memory a person writes in an empty store takes the project id from .dd/config.json', async t => {
  const root = await project(t, []);
  writeFileSync(join(root, '.dd', 'config.json'), JSON.stringify({ project_id: 'acme' }));
  const made = await createMemory(root, { topic: 'ui/new', kind: 'fact', title: 'New', body: 'Ports below 1024 need admin on src/a.js servers.',
    not_derivable: 'Hidden from the code.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }] });
  assert.equal(made.project_id, 'acme');
});

// A drafted line (written by an agent through the store) does not end the review: the person saves it.
test('re-verifying evidence re-hashes the files that exist, keeps the missing ones stale, and records the person', async t => {
  const root = await project(t, [memory('m1', { evidence: [
    { type: 'file', path: 'src/a.js', sha256: 'a'.repeat(64), summary: 'changed since' },
    { type: 'file', path: 'src/gone.js', sha256: 'b'.repeat(64), summary: 'removed' },
    { type: 'observation', ref: 'conversation', summary: 'kept as is' },
  ] })]);
  const result = await reverifyEvidence(root, 'm1');
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  assert.equal(result.memory.evidence[0].sha256, createHash('sha256').update(readFileSync(join(root, 'src', 'a.js'))).digest('hex'));
  assert.equal(result.memory.evidence[1].sha256, 'b'.repeat(64));
  assert.deepEqual(result.memory.evidence[2], { type: 'observation', ref: 'conversation', summary: 'kept as is' });
  assert.deepEqual(result.stale, ['src/gone.js']);
  assert.equal(result.memory.review.reviewed_by?.by ?? result.memory.review.accepted?.by, 'person');
});
