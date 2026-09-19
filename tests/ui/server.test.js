import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { proposeMemory } from '../../src/engine/write.js';
import { archiveMemory } from '../../src/engine/lifecycle.js';
import { RELIABILITY_CAP } from '../../src/engine/reliability.js';
import { Script } from 'node:vm';

async function json(url, opts) {
  const res = await fetch(url, opts);
  return { status: res.status, body: await res.json() };
}

// The review token is only delivered in the served page, which is the path a
// reviewer actually takes. `startUiServer` resolves `hookToken`, not this one,
// so reading it off the server object silently yields undefined and every
// non-GET request 403s while the test still looks green.
async function reviewHeaders(base) {
  const html = await (await fetch(base + '/')).text();
  return { 'content-type': 'application/json',
    'x-dd-review-token': html.match(/name="dd-review-token" content="([a-f0-9]+)"/)[1] };
}

describe('audit UI HTTP', () => {
  test('local review approves candidates and editing preserves the effective version', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const written = await proposeMemory({
      project_id: 'demo',
      capture_origin: 'model_initiated',
      memory_type: 'lesson',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      topic_key: 'memory/admission/required-fields',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'gate' }],
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    }, { store });

    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const base = ui.url;

    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    const html = await home.text();
    assert.match(html, /DeltaDictum audit/);
    assert.match(html, /id="origin-filter"/);
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new Script(script[1]);
    const token = html.match(/name="dd-review-token" content="([a-f0-9]+)"/)[1];
    const headers = { 'content-type': 'application/json', 'x-dd-review-token': token };

    const list = await json(base + '/api/atoms');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].capture_origin, 'model_initiated');

    const denied = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST' });
    assert.equal(denied.status, 403);
    const wrongOrigin = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST',
      headers: { ...headers, origin: 'http://unrelated.example' }, body: JSON.stringify({ rationale: 'Cross-origin request' }) });
    assert.equal(wrongOrigin.status, 403);
    const admitted = await json(base + '/api/atoms/' + written.atom.id + '/admit', { method: 'POST', headers, body: JSON.stringify({ rationale: 'Reviewed against the gate.' }) });
    assert.equal(admitted.body.lifecycle_state, 'active');
    assert.equal(admitted.body.capture_origin, 'model_initiated');
    assert.equal(admitted.body.capture_source, 'agent');

    const patched = await json(base + '/api/atoms/' + written.atom.id, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ why: 'A newly reviewed reason.', capture_origin: 'model_initiated', capture_source: 'agent' }),
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.atom.lifecycle_state, 'candidate');
    assert.equal(patched.body.atom.capture_origin, 'user_explicit');
    assert.equal(patched.body.atom.capture_source, 'local_ui');
    assert.equal((await store.getAtom(written.atom.id, 'demo')).lifecycle_state, 'active');
    const filtered = await json(base + '/api/atoms?capture_origin=user_explicit&lifecycle=candidate');
    assert.deepEqual(filtered.body.map(a => a.id), [patched.body.atom.id]);
    assert.deepEqual((await json(base + '/api/atoms?capture_origin=user_explicit&lifecycle=active')).body, []);

    const deleted = await json(base + '/api/atoms/' + patched.body.atom.id, { method: 'DELETE', headers });
    assert.equal(deleted.body.deleted, true);

    const empty = await json(base + '/api/atoms');
    assert.equal(empty.body.length, 1);
    assert.equal(empty.body[0].id, written.atom.id);
  });
  test('review grants the authority the reviewer chose, and only canonical lifts the source cap', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-authority-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    // No verified artifact: the source ladder caps this at its bottom rung.
    const propose = topic_key => proposeMemory({
      project_id: 'demo', memory_type: 'lesson', title: 'Reported instruction',
      trigger: 'when retrying payments', behavior_delta: 'Reuse the idempotency key.',
      what: 'Retries reuse the key.', why: 'Avoid duplicate charges.', topic_key,
      evidence_refs: [{ source_type: 'user_statement', source_ref: 'the user said so', summary: 'Reported' }],
      retrieval_forms: { micro: 'Reuse the key.', short: 'Reuse the idempotency key on retry.' },
    }, { store });
    const plain = await propose('payments/retry/plain');
    const lifted = await propose('payments/retry/lifted');

    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const headers = await reviewHeaders(ui.url);
    const admit = (id, body) => json(`${ui.url}/api/atoms/${id}/admit`,
      { method: 'POST', headers, body: JSON.stringify(body) });

    const validated = await admit(plain.atom.id, { rationale: 'Reviewed; the claim is plausible.', authority: 'validated' });
    assert.equal(validated.body.authority, 'validated');
    assert.equal(validated.body.confidence, RELIABILITY_CAP.agent_claim);

    const canonical = await admit(lifted.atom.id, { rationale: 'Reviewed; I stand behind this regardless of the evidence.', authority: 'canonical' });
    assert.equal(canonical.body.authority, 'canonical');
    assert.equal(canonical.body.confidence, 1);
  });

  test('a contested atom shows the ranking recommendation without resolving anything', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-dispute-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const propose = topic_key => proposeMemory({
      project_id: 'demo', memory_type: 'decision', title: 'Retry policy',
      trigger: 'when retrying payment requests', behavior_delta: 'Reuse the idempotency key.',
      what: 'Retries reuse the key.', why: 'Avoid duplicate charges.', topic_key,
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/write.js', summary: 'write path' }],
      retrieval_forms: { micro: 'Reuse the key.', short: 'Reuse the idempotency key on retry.' },
    }, { store });
    const first = await propose('payments/retry/keys');
    const second = await propose('payments/retry/manual');

    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const headers = await reviewHeaders(ui.url);

    for (const written of [first, second]) {
      const admitted = await json(`${ui.url}/api/atoms/${written.atom.id}/admit`,
        { method: 'POST', headers, body: JSON.stringify({ rationale: 'Reviewed against the write path.' }) });
      assert.equal(admitted.status, 200);
      assert.equal(admitted.body.lifecycle_state, 'active');
    }
    await store.commitAtoms([], [{ source_atom_id: first.atom.id, relation_type: 'contradicts', target_atom_id: second.atom.id }]);
    for (const written of [first, second]) {
      const atom = await store.getAtom(written.atom.id, 'demo');
      await store.commitAtoms([{ ...atom, lifecycle_state: 'contested', contested_at: new Date().toISOString() }]);
    }

    const viewed = await json(`${ui.url}/api/atoms/${first.atom.id}`);
    assert.equal(viewed.status, 200);
    assert.equal(viewed.body.opponents.length, 1);
    const recommendation = viewed.body.opponents[0].recommendation;
    assert.ok(recommendation, 'the reviewer is shown which side the ranking order favours');
    assert.ok('basis' in recommendation && 'winner_id' in recommendation && 'tie' in recommendation);
    if (!recommendation.tie) {
      assert.ok([first.atom.id, second.atom.id].includes(recommendation.winner_id));
      assert.ok(['evidence', 'recency', 'authority', 'predominance'].includes(recommendation.basis));
    }

    // Showing a recommendation must not resolve anything on its own.
    assert.equal((await store.getAtom(first.atom.id, 'demo')).lifecycle_state, 'contested');
    assert.equal((await store.getAtom(second.atom.id, 'demo')).lifecycle_state, 'contested');
  });

});

describe('audit UI recorded evidence', () => {
  // The stage that started recording user corrections claimed they would be
  // "visible in the audit UI". Nothing rendered any observation, host ones
  // included, so the claim was false for every source until this panel existed.
  test('observations are listed read-only, project-scoped, and offer no action', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-evidence-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const headers = await reviewHeaders(ui.url);
    await store.putObservation({ project_id: 'demo', source_type: 'user_correction', source_ref: 'UserPromptSubmit',
      raw_preview: 'User correction. No, that is wrong - retrieval is project-scoped first.',
      metadata: { provenance: 'user_correction', signal: 'correction', session_id: 'current' } });
    await store.putObservation({ project_id: 'demo', source_type: 'validation', source_ref: 'Bash',
      raw_preview: 'Validation passed (exit 0). Checks passed.', metadata: { provenance: 'host', session_id: 'current' } });
    await store.putObservation({ project_id: 'other', source_type: 'validation', source_ref: 'Bash',
      raw_preview: 'Another project.', metadata: { provenance: 'host', session_id: 'current' } });

    const listed = await json(ui.url + '/api/observations', { headers });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.length, 2);
    assert.deepEqual(listed.body.map(o => o.source_type).sort(), ['user_correction', 'validation']);
    assert.equal(listed.body.every(o => o.project_id === undefined || o.project_id === 'demo'), true);
    assert.match(listed.body.find(o => o.source_type === 'user_correction').raw_preview, /project-scoped first/);
    assert.equal(listed.body.find(o => o.source_type === 'user_correction').metadata.provenance, 'user_correction');
    assert.equal(listed.body.some(o => /Another project/.test(o.raw_preview)), false);

    // Evidence is not promotable, so the panel has nothing to submit to.
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      assert.equal((await json(ui.url + '/api/observations', { method, headers })).status, 404);
    }
    const html = await (await fetch(ui.url + '/')).text();
    assert.match(html, /id="evidence-list"/);
    assert.match(html, /Recorded evidence/);
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new Script(script[1]);
  });
});

describe('audit UI retirement', () => {
  test('archived memories are listed and a reviewer can restore one', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-archive-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const written = await proposeMemory({
      project_id: 'demo',
      memory_type: 'lesson',
      title: 'Reuse the idempotency key',
      trigger: 'when retrying payment requests',
      behavior_delta: 'Reuse the original idempotency key.',
      what: 'Retries must not double charge.',
      why: 'One logical payment is charged once.',
      topic_key: 'payments/retry/idempotency',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/write.js', summary: 'Write path' }],
      retrieval_forms: { micro: 'Reuse the key.', short: 'Reuse the original idempotency key on retry.' },
    }, { store });
    await store.putAtom({ ...written.atom, lifecycle_state: 'active', authority: 'inferred' });
    await archiveMemory(written.atom.id, { store, projectId: 'demo' });

    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const base = ui.url;
    const headers = await reviewHeaders(base);

    const archived = await json(base + '/api/atoms?lifecycle=archived');
    assert.equal(archived.status, 200);
    assert.deepEqual(archived.body.map(a => a.id), [written.atom.id]);
    assert.equal(archived.body[0].archived_reason, 'never_activated');

    const anonymous = await json(base + '/api/atoms/' + written.atom.id + '/restore', { method: 'POST' });
    assert.equal(anonymous.status, 403);

    const restored = await json(base + '/api/atoms/' + written.atom.id + '/restore', { method: 'POST', headers });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.lifecycle_state, 'active');

    // Restoring is not deletion in reverse either: a second restore has nothing
    // to act on and says so rather than reporting success.
    const again = await json(base + '/api/atoms/' + written.atom.id + '/restore', { method: 'POST', headers });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'archived_memory_required');
  });
});

describe('auto-accept config', () => {
  test('defaults to disabled, round-trips a valid update, rejects an out-of-range threshold', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-config-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const base = ui.url;
    const headers = await reviewHeaders(base);

    const initial = await json(base + '/api/config');
    assert.deepEqual(initial.body.auto_accept, { enabled: false, confidence_threshold: 0.8 });

    const updated = await json(base + '/api/config/auto-accept', { method: 'POST', headers,
      body: JSON.stringify({ enabled: true, confidence_threshold: 0.6 }) });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.auto_accept, { enabled: true, confidence_threshold: 0.6 });
    assert.deepEqual((await json(base + '/api/config')).body.auto_accept, { enabled: true, confidence_threshold: 0.6 });

    const invalid = await json(base + '/api/config/auto-accept', { method: 'POST', headers,
      body: JSON.stringify({ enabled: true, confidence_threshold: 1.5 }) });
    assert.equal(invalid.status, 409);
  });
});
