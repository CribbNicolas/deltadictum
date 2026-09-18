import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { reverifyStoredEvidence } from '../../src/engine/reverify.js';
import { RELIABILITY_CAP } from '../../src/engine/reliability.js';

// Knowledge written before the reliability ladder carries a confidence the
// ladder can never produce, and often no evidence_state at all: verification
// did not exist when it was stored. These atoms reproduce that shape.
function legacy(overrides = {}) {
  return { id: overrides.id ?? 'legacy-1', project_id: 'demo', schema_version: 6,
    memory_type: 'lesson', scope: 'project', title: 'Legacy lesson',
    topic_key: overrides.topic_key ?? 'legacy/one', trigger: 'when doing the thing',
    behavior_delta: 'Do the thing.', what: 'Do the thing.', why: 'It works.',
    tags: [], trigger_variants: [], applies_to: { files: [], components: [], operations: [] },
    assumptions: [], revisit_when: [], alternatives: [],
    evidence_refs: [{ source_type: 'file', source_ref: 'decision.md', summary: 'Contract' }],
    retrieval_forms: { micro: 'Do the thing.', short: 'Do the thing. Why: It works.' },
    authority: 'inferred', confidence: 0.7, lifecycle_state: 'active',
    valid_from: '2026-01-01T00:00:00.000Z', valid_until: null, ...overrides };
}

async function setup(atoms) {
  const root = await mkdtemp(join(tmpdir(), 'dd-reverify-'));
  await writeFile(join(root, 'decision.md'), 'The contract.');
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  for (const atom of atoms) await store.putAtom(atom);
  return { root, store };
}

describe('reverifying stored evidence', () => {
  test('a resolvable reference verifies and lifts the legacy confidence to what it earns', async () => {
    const f = await setup([legacy()]);
    const report = await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    assert.equal(report.changed.length, 1);
    assert.equal(report.changed[0].provenance, 'filesystem');
    assert.equal(report.changed[0].from, 0.7);
    assert.equal(report.changed[0].to, RELIABILITY_CAP.filesystem);
    const stored = await f.store.getAtom('legacy-1', 'demo');
    assert.equal(stored.confidence, RELIABILITY_CAP.filesystem);
    assert.equal(stored.evidence_state.artifacts[0].status, 'verified');
    assert.ok(stored.evidence_state.artifacts[0].hash);
    f.store.close();
  });

  test('an unresolvable reference is an agent claim and is demoted to the bottom rung', async () => {
    const f = await setup([legacy({ id: 'legacy-2', topic_key: 'legacy/two',
      evidence_refs: [{ source_type: 'file', source_ref: 'deleted.md', summary: 'Gone' }] })]);
    await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    const stored = await f.store.getAtom('legacy-2', 'demo');
    assert.equal(stored.confidence, RELIABILITY_CAP.agent_claim);
    assert.equal(stored.evidence_state.artifacts[0].status, 'unavailable');
    f.store.close();
  });

  test('it derives confidence and evidence only, and promotes nothing', async () => {
    const f = await setup([legacy()]);
    const before = await f.store.getAtom('legacy-1', 'demo');
    await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    const after = await f.store.getAtom('legacy-1', 'demo');
    // Authority and lifecycle are review decisions. Re-deriving a number from
    // stored evidence is not a review, so it must move neither.
    assert.equal(after.authority, before.authority);
    assert.equal(after.lifecycle_state, before.lifecycle_state);
    assert.equal(after.review, before.review);
    assert.equal(after.evidence_state.support, 'unreviewed');
    assert.deepEqual(after.evidence_refs, before.evidence_refs);
    assert.equal(after.behavior_delta, before.behavior_delta);
    f.store.close();
  });

  test('a reviewed memory keeps its reviewed support', async () => {
    const f = await setup([legacy({ id: 'legacy-3', topic_key: 'legacy/three', authority: 'validated',
      review: { source: 'local_ui', reviewed_at: '2026-02-02T00:00:00.000Z', rationale: 'Checked.' } })]);
    await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    const stored = await f.store.getAtom('legacy-3', 'demo');
    assert.equal(stored.evidence_state.support, 'human_reviewed');
    assert.equal(stored.confidence, RELIABILITY_CAP.filesystem);
    f.store.close();
  });

  test('a canonical grant gains a verification record without its confidence moving', async () => {
    const f = await setup([legacy({ id: 'legacy-4', topic_key: 'legacy/four', authority: 'canonical',
      confidence: 1, evidence_refs: [{ source_type: 'user_statement', source_ref: 'said so', summary: 'Claim' }] })]);
    const report = await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    assert.equal(report.changed.length, 1);
    // The claim verifies as nothing, and the reviewer's grant still stands.
    assert.equal(report.changed[0].provenance, 'agent_claim');
    assert.equal(report.changed[0].from, 1);
    assert.equal(report.changed[0].to, 1);
    const stored = await f.store.getAtom('legacy-4', 'demo');
    assert.equal(stored.confidence, 1);
    assert.equal(stored.evidence_state.verified_count, 0);
    f.store.close();
  });

  test('a reference that escapes the repository is reported and never written', async () => {
    const f = await setup([legacy({ id: 'legacy-5', topic_key: 'legacy/five',
      evidence_refs: [{ source_type: 'file', source_ref: '../outside.md', summary: 'Escapes' }] })]);
    const report = await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    assert.deepEqual(report.changed, []);
    assert.equal(report.skipped.length, 1);
    assert.equal(report.skipped[0].reason, 'evidence_scope_violation');
    // Untouched: admission refuses an out-of-scope reference, so this does too.
    const stored = await f.store.getAtom('legacy-5', 'demo');
    assert.equal(stored.confidence, 0.7);
    assert.equal(stored.evidence_state, undefined);
    f.store.close();
  });

  test('without apply it reports the change and writes nothing', async () => {
    const f = await setup([legacy()]);
    const report = await reverifyStoredEvidence({ store: f.store, projectId: 'demo' });
    assert.equal(report.changed.length, 1);
    assert.equal(report.applied, false);
    const stored = await f.store.getAtom('legacy-1', 'demo');
    assert.equal(stored.confidence, 0.7);
    assert.equal(stored.evidence_state, undefined);
    f.store.close();
  });

  test('running it twice changes nothing the second time', async () => {
    const f = await setup([legacy()]);
    await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    const second = await reverifyStoredEvidence({ store: f.store, projectId: 'demo', apply: true });
    assert.deepEqual(second.changed, []);
    f.store.close();
  });
});
