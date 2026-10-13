import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { acceptMemory, archiveMemory, createMemory, deleteMemory, editMemory, mergeMemories, rejectMemory, restoreMemory, retopicMemory, ReviewError } from '../../src/ui/actions.js';
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
