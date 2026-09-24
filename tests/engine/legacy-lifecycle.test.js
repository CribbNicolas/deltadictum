import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { archiveMemory, restoreMemory, admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { proposeMemory } from '../../src/engine/write.js';
import { PROVENANCE } from '../helpers/atom.js';

const base = (id, extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project', title: `T ${id}`,
  trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'inferred', confidence: 0.6,
  valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [], trigger_variants: [],
  assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: 'active', ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-lifecycle-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}

test('archiving needs a readable reason', async t => {
  const s = await store(t);
  await s.putAtom(base('b1'));
  await assert.rejects(archiveMemory('b1', { store: s, projectId: 'demo', reason: '  ' }), /archive_reason_required/);
  const archived = await archiveMemory('b1', { store: s, projectId: 'demo', reason: 'Never activated in 40 retrievals.' });
  assert.equal(archived.archived_reason, 'Never activated in 40 retrievals.');
});

test('a legacy memory is restored like an archived one', async t => {
  const s = await store(t);
  await s.putAtom(base('b2', { lifecycle_state: 'legacy', legacy_reason: 'Old.', legacy_at: '2026-09-24T00:00:00.000Z' }));
  const restored = await restoreMemory('b2', { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
  assert.equal(restored.lifecycle_state, 'active');
  assert.equal(restored.legacy_reason, null);
});

test('a candidate with an open revision request cannot be admitted', async t => {
  const s = await store(t);
  const { atom } = await proposeMemory({ project_id: 'demo', topic_key: 'demo/area/b3', trigger: 'when testing revisions',
    behavior_delta: 'Check revision gating.', why: 'Review asked for changes.', capture_origin: 'model_initiated',
    evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] }, { store: s });
  await s.putAtom({ ...atom, revision_requested: { reason: 'Narrow the scope.', at: '2026-09-24T00:00:00.000Z' } });
  await assert.rejects(admitMemory(atom.id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'ok' }), /revision_requested/);
});
