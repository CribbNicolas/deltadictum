import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { fileActions, applyAction } from '../../src/engine/actions.js';
import { HUMAN_REVIEW, declareContradiction } from '../../src/engine/lifecycle.js';
import { proposeMemory } from '../../src/engine/write.js';
import { requestRevision } from '../../src/engine/revisions.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, state = 'active', extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project',
  title: `T ${id}`, trigger: `when handling case ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated',
  confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [],
  trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: state, ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-review-fixes-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}
const file = async (s, action) => {
  const [filed] = await fileActions([{ rationale: 'The user asked for it.', ...action }], { store: s, projectId: 'demo' });
  if (filed.error) throw new Error(filed.error);
  return filed.id;
};
const apply = (s, id) => applyAction(id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
const state = async (s, id) => (await s.getAtom(id, 'demo'))?.lifecycle_state;
const proposal = { topic_key: 'demo/rev/one', trigger: 'when revising proposals', behavior_delta: 'Revise with the reason.',
  why: 'Review found a gap.', capture_origin: 'model_initiated',
  evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] };

// Review finding 1: retiring one side of a dispute must settle the other side.
test('archiving, retiring or moving one side of a dispute leaves no memory stuck contested', async t => {
  for (const [kind, extra] of [['archive', { archived_reason: 'Unused.' }], ['legacy', { legacy_reason: 'Abandoned.' }],
    ['retopic', { topic_key: 'demo/moved/p' }]]) {
    const s = await store(t);
    await s.putAtom(atom('p'));
    await s.putAtom(atom('q'));
    await declareContradiction('p', 'q', { store: s, projectId: 'demo' });
    await apply(s, await file(s, { kind, targets: ['p'], ...extra }));
    assert.equal(await state(s, 'q'), 'active', kind);
    const moved = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['active', 'contested'] })).find(a => a.topic_key === 'demo/moved/p');
    if (moved) { assert.equal(moved.lifecycle_state, 'active'); assert.equal(moved.contested_at ?? null, null); }
  }
});

// Review finding 2: `revises` answers a revision request; it is not a way to withdraw anything.
test('revises closes only a candidate or action with an open revision request, never the correction itself', async t => {
  const s = await store(t);
  const { atom: untouched } = await proposeMemory({ ...proposal, project_id: 'demo' }, { store: s });
  await proposeMemory({ ...proposal, project_id: 'demo', topic_key: 'demo/rev/two', revises: untouched.id }, { store: s });
  assert.equal(await state(s, untouched.id), 'candidate');
  await requestRevision({ kind: 'memory', id: untouched.id, reason: 'Say why.' }, { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
  const byTopic = await proposeMemory({ ...proposal, project_id: 'demo', why: 'Review found a gap in hooks.', revises: 'demo/rev/one' }, { store: s });
  assert.equal(await state(s, byTopic.atom.id), 'candidate');
  assert.equal(await state(s, untouched.id), 'candidate');
  await s.putAtom(atom('h1'));
  const first = await file(s, { kind: 'archive', targets: ['h1'], archived_reason: 'Unused.' });
  await file(s, { kind: 'archive', targets: ['h1'], archived_reason: 'Duplicate.', revises: first });
  assert.ok(await s.getAction(first));
});

// Review findings (re-graded): every archive states why; targets are recorded by id.
test('blank reasons are refused and targets are stored as ids', async t => {
  const s = await store(t);
  await s.putAtom(atom('r1'));
  await s.putAtom(atom('r2'));
  const [blankArchive, blankLegacy] = await fileActions([
    { kind: 'archive', targets: ['r1'], archived_reason: '   ', rationale: 'Asked.' },
    { kind: 'legacy', targets: ['r1'], legacy_reason: ' ', rationale: 'Asked.' }], { store: s, projectId: 'demo' });
  assert.equal(blankArchive.error, 'field_required:archived_reason');
  assert.equal(blankLegacy.error, 'field_required:legacy_reason');
  const [byTopic] = await fileActions([{ kind: 'archive', targets: ['demo/area/r1'], archived_reason: 'Unused.', rationale: 'Asked.' }],
    { store: s, projectId: 'demo' });
  assert.deepEqual((await s.getAction(byTopic.id)).targets, ['r1']);
  const [twice] = await fileActions([{ kind: 'merge', targets: ['r1', 'demo/area/r1'], rationale: 'Asked.',
    result: { ...proposal, topic_key: 'demo/area/merged' } }], { store: s, projectId: 'demo' });
  assert.equal(twice.error, 'target_count:2-10');
});
