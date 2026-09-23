import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { sweepAutoAccept } from '../../src/engine/auto-accept.js';

// Evidence must verify against the fixture's OWN repoRoot (the tmp dir),
// never against this repository's real files -- a `file` ref naming a path
// that only exists in the real checkout never resolves for a fixture store.
async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'dd-auto-accept-'));
  await writeFile(join(root, 'evidence.txt'), 'gate implementation');
  return createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
}

function proposal(overrides = {}) {
  return {
    project_id: 'demo', capture_origin: 'model_initiated', memory_type: 'lesson',
    title: 'Require trigger', trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first', what: 'Durable memory needs a trigger.', why: 'Stops unstructured dumps.',
    topic_key: 'memory/admission/required-fields',
    evidence_refs: [{ source_type: 'file', source_ref: 'evidence.txt', summary: 'gate' }],
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    ...overrides,
  };
}

describe('sweepAutoAccept', () => {
  test('disabled config admits nothing', async t => {
    const store = await fixtureStore();
    t.after(() => store.close());
    const config = await store.loadConfig();
    config.auto_accept = { ...config.auto_accept, enabled: false };
    await store.saveConfig(config);
    const { atom } = await proposeMemory(proposal(), { store });
    const result = await sweepAutoAccept({ store, projectId: 'demo' });
    assert.deepEqual(result.admitted, []);
    assert.equal((await store.getAtom(atom.id, 'demo')).lifecycle_state, 'candidate');
  });

  test('enabled config admits a candidate with real verified evidence, leaves an unverifiable one untouched', async t => {
    const store = await fixtureStore();
    t.after(() => store.close());
    const config = await store.loadConfig();
    // Between the two projected confidence values: 0.765 (verified filesystem
    // ref) and 0.45 (a file ref that never resolves, stays agent_claim).
    config.auto_accept = { enabled: true, confidence_threshold: 0.6 };
    await store.saveConfig(config);

    const { atom: verified } = await proposeMemory(proposal({ topic_key: 'memory/admission/topic-a',
      evidence_refs: [{ source_type: 'file', source_ref: 'evidence.txt', summary: 'gate' }] }), { store });
    const { atom: unverifiable } = await proposeMemory(proposal({ topic_key: 'memory/admission/topic-b',
      evidence_refs: [{ source_type: 'file', source_ref: 'does-not-exist.txt', summary: 'gate' }] }), { store });

    const result = await sweepAutoAccept({ store, projectId: 'demo' });
    assert.ok(result.admitted.includes(verified.id));
    assert.equal((await store.getAtom(verified.id, 'demo')).lifecycle_state, 'active');
    assert.ok(!result.admitted.includes(unverifiable.id));
    assert.equal((await store.getAtom(unverifiable.id, 'demo')).lifecycle_state, 'candidate');
  });

  test('a candidate admitMemory rejects (stale replacement target) stays a candidate, not an error', async t => {
    const store = await fixtureStore();
    t.after(() => store.close());
    const { atom } = await proposeMemory(proposal({ topic_key: 'memory/admission/stale-replacement' }), { store });
    await store.putAtom({ ...atom, replaces: 'does-not-exist' });

    const config = await store.loadConfig();
    config.auto_accept = { enabled: true, confidence_threshold: 0 };
    await store.saveConfig(config);
    const result = await sweepAutoAccept({ store, projectId: 'demo' });
    assert.ok(!result.admitted.includes(atom.id));
    assert.equal((await store.getAtom(atom.id, 'demo')).lifecycle_state, 'candidate');
  });

  test('rationale names the projected confidence and threshold', async t => {
    const store = await fixtureStore();
    t.after(() => store.close());
    const { atom } = await proposeMemory(proposal(), { store }); // real, verifiable evidence_ref -> 0.765
    const config = await store.loadConfig();
    config.auto_accept = { enabled: true, confidence_threshold: 0 };
    await store.saveConfig(config);
    await sweepAutoAccept({ store, projectId: 'demo' });
    const admitted = await store.getAtom(atom.id, 'demo');
    assert.equal(admitted.lifecycle_state, 'active');
    assert.equal(admitted.review.rationale, 'Auto-accepted: confidence 0.765 >= threshold 0.');
  });
});

// Two drafts of one topic, both clearing the threshold: accepting both in list
// order let the older draft supersede the newer one (seen 2026-09-22).
test('with several candidates on one topic, only the newest is auto-accepted', async t => {
  const store = await fixtureStore();
  t.after(() => store.close());
  const older = await proposeMemory(proposal({ behavior_delta: 'validate trigger first' }), { store });
  await new Promise(resolve => setTimeout(resolve, 5));
  const newer = await proposeMemory(proposal({ behavior_delta: 'validate trigger, evidence and forms before any write' }), { store });
  const result = await sweepAutoAccept({ store, projectId: 'demo' });
  assert.deepEqual(result.admitted, [newer.atom.id]);
  assert.equal((await store.getAtom(newer.atom.id, 'demo')).lifecycle_state, 'active');
  assert.equal((await store.getAtom(older.atom.id, 'demo')).lifecycle_state, 'candidate');
});
