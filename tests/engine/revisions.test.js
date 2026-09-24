import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { requestRevision, openRevisionRequests, revisionNotices } from '../../src/engine/revisions.js';
import { fileActions, applyAction } from '../../src/engine/actions.js';
import { proposeMemory } from '../../src/engine/write.js';
import { sweepAutoAccept } from '../../src/engine/auto-accept.js';
import { HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project', title: `T ${id}`,
  trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated', confidence: 0.8,
  valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [], trigger_variants: [],
  assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: 'active', ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-revisions-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}
const proposal = { topic_key: 'demo/rev/one', trigger: 'when revising proposals', behavior_delta: 'Revise with the reason.',
  why: 'Review found a gap.', capture_origin: 'model_initiated',
  evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] };
const review = { actor: HUMAN_REVIEW };

test('a revision request reaches each session once and blocks auto-accept', async t => {
  const s = await store(t);
  const { atom: candidate } = await proposeMemory({ ...proposal, project_id: 'demo' }, { store: s });
  await assert.rejects(requestRevision({ kind: 'memory', id: candidate.id, reason: ' ' }, { store: s, projectId: 'demo', ...review }),
    /revision_reason_required/);
  await assert.rejects(requestRevision({ kind: 'memory', id: candidate.id, reason: 'x' }, { store: s, projectId: 'demo' }),
    /human_review_required/);
  await requestRevision({ kind: 'memory', id: candidate.id, reason: 'Scope it to the hooks only' }, { store: s, projectId: 'demo', ...review });
  assert.equal((await openRevisionRequests(s, 'demo'))[0].reason, 'Scope it to the hooks only');
  const first = await revisionNotices({ store: s, projectId: 'demo', sessionId: 's1' });
  assert.equal(first, `DD - Revision requested for memory ${candidate.id} (demo/rev/one): Scope it to the hooks only. `
    + `File a corrected version with revises=${candidate.id}.`);
  assert.equal(await revisionNotices({ store: s, projectId: 'demo', sessionId: 's1' }), null);
  assert.ok(await revisionNotices({ store: s, projectId: 'demo', sessionId: 's2' }));
  await s.saveConfig({ ...(await s.loadConfig()), auto_accept: { enabled: true, confidence_threshold: 0 } });
  assert.deepEqual((await sweepAutoAccept({ store: s, projectId: 'demo' })).admitted, []);
});

test('an action with a revision request cannot be applied', async t => {
  const s = await store(t);
  await s.putAtom(atom('h0'));
  const [filed] = await fileActions([{ kind: 'archive', targets: ['h0'], archived_reason: 'Unused.', rationale: 'Asked.' }],
    { store: s, projectId: 'demo' });
  await requestRevision({ kind: 'action', id: filed.id, reason: 'Say which duplicate.' }, { store: s, projectId: 'demo', ...review });
  await assert.rejects(applyAction(filed.id, { store: s, projectId: 'demo', ...review }), /revision_requested/);
});

test('revises closes the original candidate and the original action', async t => {
  const s = await store(t);
  const { atom: candidate } = await proposeMemory({ ...proposal, project_id: 'demo' }, { store: s });
  await requestRevision({ kind: 'memory', id: candidate.id, reason: 'Say why.' }, { store: s, projectId: 'demo', ...review });
  const revised = await proposeMemory({ ...proposal, project_id: 'demo', why: 'Review found a gap in the hooks.', revises: candidate.id },
    { store: s });
  const old = await s.getAtom(candidate.id, 'demo');
  assert.equal(old.lifecycle_state, 'rejected');
  assert.equal(old.revised_by, revised.atom.id);
  await s.putAtom(atom('h1'));
  const [first] = await fileActions([{ kind: 'archive', targets: ['h1'], archived_reason: 'Unused.', rationale: 'Asked.' }],
    { store: s, projectId: 'demo' });
  await requestRevision({ kind: 'action', id: first.id, reason: 'Say which duplicate.' }, { store: s, projectId: 'demo', ...review });
  await fileActions([{ kind: 'archive', targets: ['h1'], archived_reason: 'Duplicate of h2.', rationale: 'Asked.', revises: first.id }],
    { store: s, projectId: 'demo' });
  assert.equal(await s.getAction(first.id), null);
  assert.equal((await s.listActionLog('demo'))[0].outcome, 'revised');
  assert.equal((await openRevisionRequests(s, 'demo')).length, 0);
});
