import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { fileActions } from '../../src/engine/actions.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, state = 'active', extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project',
  title: `T ${id}`, trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated',
  confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [],
  trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: state, ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-actions-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}
const result = { topic_key: 'demo/area/c3', trigger: 'when merging rules', behavior_delta: 'Merge them.', why: 'Same.',
  capture_origin: 'model_initiated', evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] };

test('a valid action is filed pending with a snapshot of its targets', async t => {
  const s = await store(t);
  await s.putAtom(atom('c1'));
  const [filed] = await fileActions([{ kind: 'archive', targets: ['c1'], archived_reason: 'Duplicate of c2.',
    rationale: 'The user asked to archive it.' }], { store: s, projectId: 'demo', sessionId: 's1' });
  assert.equal(filed.status, 'pending');
  const stored = await s.getAction(filed.id);
  assert.equal(stored.snapshot.c1, `${(await s.getAtom('c1', 'demo')).updated_at}|active`);
  assert.equal(stored.session_id, 's1');
  assert.equal(stored.fields.archived_reason, 'Duplicate of c2.');
  assert.equal((await s.getAtom('c1', 'demo')).lifecycle_state, 'active');
});

test('unknown targets, wrong states, missing fields and non-English text are refused at filing', async t => {
  const s = await store(t);
  await s.putAtom(atom('c2'));
  const results = await fileActions([
    { kind: 'archive', targets: ['nope'], archived_reason: 'x', rationale: 'Asked.' },
    { kind: 'delete', targets: ['c2'], rationale: 'Asked.' },
    { kind: 'legacy', targets: ['c2'], rationale: 'Asked.' },
    { kind: 'archive', targets: ['c2'], archived_reason: 'Ya no sirve para nada en este proyecto.', rationale: 'El usuario lo pidió así.' },
    { kind: 'teleport', targets: ['c2'], rationale: 'Asked.' },
  ], { store: s, projectId: 'demo' });
  assert.deepEqual(results.map(r => r.error), ['target_not_found:nope', 'target_state_not_allowed:c2:active',
    'field_required:legacy_reason', 'action_must_be_english', 'unknown_action_kind']);
  assert.equal((await s.listActions('demo')).length, 0);
});

test('a merge result is checked like a proposal, and legacy cannot merge with current knowledge', async t => {
  const s = await store(t);
  await s.putAtom(atom('c3'));
  await s.putAtom(atom('c4'));
  await s.putAtom(atom('c5', 'legacy', { legacy_reason: 'Old.' }));
  const [bad, mixed] = await fileActions([
    { kind: 'merge', targets: ['c3', 'c4'], rationale: 'Same rule.', result: { ...result, behavior_delta: '' } },
    { kind: 'merge', targets: ['c3', 'c5'], rationale: 'Same rule.', legacy_reason: 'Old.', result },
  ], { store: s, projectId: 'demo' });
  assert.match(bad.error, /^result_not_admissible:/);
  assert.equal(mixed.error, 'mixed_legacy_merge');
});
