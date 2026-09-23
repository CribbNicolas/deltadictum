import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../../src/store/create-store.js';
import { candidateFilePath } from '../../../src/store/paths.js';
import { proposeMemory } from '../../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../../src/engine/lifecycle.js';
import { createToolHandlers } from '../../../src/mcp/tools.js';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-capture-origin-'));
  await writeFile(join(root, 'decision.md'), 'Retries reuse the original idempotency key.');
  const options = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  const f = { options, store: await createMemoryStore(options) };
  t.after(() => f.store.close());
  f.payload = { project_id: 'demo', capture_origin: 'model_initiated', topic_key: 'payments/retry/keys', trigger: 'when retrying payments',
    behavior_delta: 'Reuse the original idempotency key.', why: 'Avoid duplicate charges.',
    evidence_refs: [{ source_type: 'file', source_ref: 'decision.md', summary: 'Retry contract' }] };
  f.review = () => ({ store: f.store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Checked against the retry contract.' });
  f.restart = async () => { f.store.close(); f.store = await createMemoryStore(options); };
  return f;
}

test('capture origin survives review, replacement history, reindex and restart', async t => {
  const f = await setup(t);
  const first = (await proposeMemory(f.payload, f)).atom;
  assert.equal(first.capture_origin, 'model_initiated');
  assert.equal(first.capture_source, 'agent');
  const disk = JSON.parse(await readFile(candidateFilePath(f.options.ddDir, first.id), 'utf8'));
  assert.equal(disk.capture_origin, 'model_initiated');
  assert.equal(disk.capture_source, 'agent');
  const approved = await admitMemory(first.id, f.review());
  assert.equal(approved.capture_origin, 'model_initiated');
  const revised = (await proposeMemory({ ...f.payload, why: 'Provider deduplication depends on key reuse.', capture_origin: 'user_explicit' }, f)).atom;
  assert.equal(revised.capture_origin, 'user_explicit');
  assert.equal(revised.capture_source, 'agent');
  assert.equal(revised.lifecycle_state, 'candidate');
  assert.equal(revised.authority, 'inferred');
  await admitMemory(revised.id, f.review());
  await f.store.reindex();
  await f.restart();
  const historical = await f.store.getAtom(first.id, 'demo');
  assert.equal(historical.lifecycle_state, 'superseded');
  assert.equal(historical.capture_origin, 'model_initiated');
  const current = await f.store.getAtom(revised.id, 'demo');
  assert.equal(current.lifecycle_state, 'active');
  assert.equal(current.capture_origin, 'user_explicit');
  assert.equal(current.capture_source, 'agent');
});

test('agent origin claims cannot forge the transport, approve knowledge or claim an origin outside the contract', async t => {
  const f = await setup(t);
  for (const origin of ['unknown', 'automatic', '', 1]) {
    const result = await proposeMemory({ ...f.payload, capture_origin: origin }, f);
    assert.equal(result.decision, 'block');
    assert.ok(result.reasons.includes('invalid_capture_origin'));
  }
  const result = await proposeMemory({ ...f.payload, capture_origin: 'user_explicit', capture_source: 'local_ui',
    lifecycle_state: 'active', authority: 'canonical', review: { actor: 'local_ui' } }, f);
  assert.equal(result.atom.capture_source, 'agent');
  assert.equal(result.atom.capture_origin, 'user_explicit');
  assert.equal(result.atom.lifecycle_state, 'candidate');
  assert.equal(result.atom.authority, 'inferred');
  assert.equal(result.atom.review, undefined);
});

test('equivalent user requests preserve the first capture attribution without duplicate memories', async t => {
  const f = await setup(t);
  const first = (await proposeMemory(f.payload, f)).atom;
  const repeated = await proposeMemory({ ...f.payload, capture_origin: 'user_explicit' }, f);
  assert.equal(repeated.decision, 'ignore');
  assert.equal(repeated.atom.id, first.id);
  assert.equal(repeated.atom.capture_origin, 'model_initiated');
  assert.equal((await f.store.listAtoms({ projectId: 'demo' })).length, 1);
});

test('an agent revision records its own declared origin and defaults missing origin to user_explicit', async t => {
  const f = await setup(t);
  // A revision travels the same road as any other proposal: same topic_key, new
  // candidate, original untouched until review. There is no in-place update path.
  const first = (await proposeMemory({ ...f.payload, capture_origin: 'user_explicit' }, f)).atom;
  const tools = createToolHandlers({ store: f.store, projectId: 'demo' });
  const result = await tools.propose({ proposals: [{ ...f.payload, capture_origin: 'model_initiated',
    why: 'New evidence found while debugging retries.' }] });
  assert.equal(result.isError, undefined);
  const revised = JSON.parse(result.content[0].text).proposals[0];
  assert.equal(revised.capture_origin, 'model_initiated');
  assert.equal(revised.capture_source, 'agent');
  assert.equal((await f.store.getAtom(first.id, 'demo')).capture_origin, 'user_explicit');
  const { capture_origin, ...withoutOrigin } = f.payload;
  const omitted = await tools.propose({ proposals: [{ ...withoutOrigin,
    why: 'A further revision without a declared origin.' }] });
  assert.equal(JSON.parse(omitted.content[0].text).proposals[0].capture_origin, 'user_explicit');
});

test('a new proposal with no capture field defaults to user_explicit in the persisted memory', async t => {
  const f = await setup(t);
  const { capture_origin, ...payload } = f.payload;
  const result = await proposeMemory(payload, f);
  assert.equal(result.atom.capture_origin, 'user_explicit');
  assert.equal(result.atom.capture_source, 'agent');
  const disk = JSON.parse(await readFile(candidateFilePath(f.options.ddDir, result.atom.id), 'utf8'));
  assert.equal(disk.capture_origin, 'user_explicit');
});

// Provenance is part of the stored contract: an atom without it is refused and
// reported, never read with an origin DD would have to invent.
test('an atom stored without its capture origin is refused, not defaulted', async t => {
  const f = await setup(t);
  const first = (await proposeMemory(f.payload, f)).atom;
  const { capture_origin, capture_source, ...bare } = first;
  const path = candidateFilePath(f.options.ddDir, first.id);
  await writeFile(path, `${JSON.stringify(bare, null, 2)}\n`);
  const before = await readFile(path, 'utf8');
  await f.store.reindex();
  await f.restart();
  assert.equal(await f.store.getAtom(first.id, 'demo'), null);
  assert.deepEqual(await f.store.listAtoms({ projectId: 'demo' }), []);
  assert.deepEqual(await f.store.search({ projectId: 'demo', query: 'payments' }), []);
  const health = await f.store.assessDeterioration('demo');
  const indicator = health.indicators.find(i => i.id === 'unsupported_atoms');
  assert.equal(indicator.status, 'deteriorated');
  assert.deepEqual(indicator.offenders.map(o => [o.id, o.reason]), [[first.id, 'invalid_capture_origin']]);
  assert.equal(await readFile(path, 'utf8'), before);
});
