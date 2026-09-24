import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { fileActions, applyAction, rejectAction } from '../../src/engine/actions.js';
import { HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, state = 'active', extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project',
  title: `T ${id}`, trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated',
  confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [],
  trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: state, ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-apply-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}
const file = async (s, action) => {
  const [filed] = await fileActions([{ rationale: 'The user asked for it.', ...action }], { store: s, projectId: 'demo' });
  if (filed.error) throw new Error(filed.error);
  return filed.id;
};
const apply = (s, id) => applyAction(id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Reviewed.' });
const state = async (s, id) => (await s.getAtom(id, 'demo'))?.lifecycle_state;
const result = { topic_key: 'demo/area/merged', title: 'Merged rule', trigger: 'when doing merged work',
  behavior_delta: 'Do the merged thing.', why: 'Both said the same.', capture_origin: 'model_initiated',
  evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked to merge.' }] };

test('applying needs human review and changes nothing before', async t => {
  const s = await store(t);
  await s.putAtom(atom('d1'));
  const id = await file(s, { kind: 'archive', targets: ['d1'], archived_reason: 'Unused.' });
  await assert.rejects(applyAction(id, { store: s, projectId: 'demo' }), /human_review_required/);
  assert.equal(await state(s, 'd1'), 'active');
  await apply(s, id);
  assert.equal(await state(s, 'd1'), 'archived');
  assert.equal((await s.getAtom('d1', 'demo')).archived_reason, 'Unused.');
  assert.equal(await s.getAction(id), null);
  assert.equal((await s.listActionLog('demo'))[0].outcome, 'applied');
});

test('merge moves each source one step down and admits the result', async t => {
  const s = await store(t);
  await s.putAtom(atom('d2'));
  await s.putAtom(atom('d3', 'superseded'));
  await apply(s, await file(s, { kind: 'merge', targets: ['d2', 'd3'], result }));
  const merged = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['active'] })).find(a => a.topic_key === 'demo/area/merged');
  assert.equal(merged.authority, 'validated');
  assert.equal((await s.getAtom('d2', 'demo')).superseded_by, merged.id);
  assert.equal(await state(s, 'd2'), 'superseded');
  assert.equal(await state(s, 'd3'), 'archived');
  assert.equal((await s.getAtom('d3', 'demo')).archived_reason, `merged into ${merged.id}`);
});

test('an all-legacy merge yields one legacy memory and archives its sources', async t => {
  const s = await store(t);
  await s.putAtom(atom('d4', 'legacy', { legacy_reason: 'Old.' }));
  await s.putAtom(atom('d5', 'legacy', { legacy_reason: 'Old.' }));
  await apply(s, await file(s, { kind: 'merge', targets: ['d4', 'd5'], result, legacy_reason: 'Both describe the removed installer.' }));
  const merged = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['legacy'] })).find(a => a.topic_key === 'demo/area/merged');
  assert.equal(merged.legacy_reason, 'Both describe the removed installer.');
  assert.equal(await state(s, 'd4'), 'archived');
});

test('a merge whose result topic belongs to another memory is refused and changes nothing', async t => {
  const s = await store(t);
  await s.putAtom(atom('d7'));
  await s.putAtom(atom('d8'));
  await s.putAtom(atom('holder', 'active', { topic_key: 'demo/area/merged' }));
  const id = await file(s, { kind: 'merge', targets: ['d7', 'd8'], result });
  await assert.rejects(apply(s, id), /topic_key_taken/);
  assert.equal(await state(s, 'd7'), 'active');
  assert.ok(await s.getAction(id));
});

test('a target changed since filing makes the action stale', async t => {
  const s = await store(t);
  await s.putAtom(atom('d9'));
  const id = await file(s, { kind: 'legacy', targets: ['d9'], legacy_reason: 'Abandoned.' });
  await new Promise(resolve => setTimeout(resolve, 5));
  await s.putAtom({ ...(await s.getAtom('d9', 'demo')), why: 'Edited since.' });
  await assert.rejects(apply(s, id), /action_stale/);
  assert.equal((await s.getAction(id)).status, 'stale');
  assert.equal(await state(s, 'd9'), 'active');
});

test('restore, delete, legacy, retopic and split apply', async t => {
  const s = await store(t);
  await s.putAtom(atom('e1', 'archived', { archived_reason: 'x' }));
  await s.putAtom(atom('e2', 'rejected'));
  await s.putAtom(atom('e3'));
  await s.putAtom(atom('e4'));
  await apply(s, await file(s, { kind: 'restore', targets: ['e1'] }));
  assert.equal(await state(s, 'e1'), 'active');
  await apply(s, await file(s, { kind: 'delete', targets: ['e2'] }));
  assert.equal(await s.getAtom('e2', 'demo'), null);
  await apply(s, await file(s, { kind: 'legacy', targets: ['e3'], legacy_reason: 'Abandoned.', replaced_by: 'e4' }));
  assert.equal((await s.getAtom('e3', 'demo')).replaced_by, 'e4');
  assert.equal(await state(s, 'e3'), 'legacy');
  await apply(s, await file(s, { kind: 'retopic', targets: ['e4'], topic_key: 'demo/moved/e4' }));
  const moved = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['active'] })).find(a => a.topic_key === 'demo/moved/e4');
  assert.ok(moved);
  assert.equal(await state(s, 'e4'), 'superseded');
  await apply(s, await file(s, { kind: 'split', targets: [moved.id], results: [
    { ...result, topic_key: 'demo/split/one', trigger: 'when doing the first part', behavior_delta: 'Do part one.' },
    { ...result, topic_key: 'demo/split/two', trigger: 'when doing the second part', behavior_delta: 'Do part two.' }] }));
  assert.equal(await state(s, moved.id), 'superseded');
  const topics = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['active'] })).map(a => a.topic_key);
  assert.ok(topics.includes('demo/split/one') && topics.includes('demo/split/two'));
});

test('resolve sends the loser to the chosen state', async t => {
  const s = await store(t);
  await s.putAtom(atom('f1', 'contested'));
  await s.putAtom(atom('f2', 'contested'));
  await s.commitAtoms([], [{ source_atom_id: 'f1', relation_type: 'contradicts', target_atom_id: 'f2' }]);
  await apply(s, await file(s, { kind: 'resolve', targets: ['f1', 'f2'], winner: 'f1', loser_state: 'legacy', legacy_reason: 'Proved wrong.' }));
  assert.equal(await state(s, 'f1'), 'active');
  assert.equal(await state(s, 'f2'), 'legacy');
  assert.equal((await s.getAtom('f2', 'demo')).replaced_by, 'f1');
});

test('reject removes the action and logs it', async t => {
  const s = await store(t);
  await s.putAtom(atom('g1'));
  const id = await file(s, { kind: 'archive', targets: ['g1'], archived_reason: 'Unused.' });
  await rejectAction(id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW, note: 'Still useful.' });
  assert.equal(await s.getAction(id), null);
  assert.equal((await s.listActionLog('demo'))[0].note, 'Still useful.');
  assert.equal(await state(s, 'g1'), 'active');
});
