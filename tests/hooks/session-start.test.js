import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { buildSessionStartContext } from '../../src/hooks/session-start.js';

describe('SessionStart context', () => {
  test('announces DD loaded and audit URL even with no memories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const payload = await buildSessionStartContext({
      store,
      projectId: 'demo',
      uiUrl: 'http://127.0.0.1:7733',
    });
    const text = payload.hookSpecificOutput.additionalContext;
    assert.match(text, /DD - loaded for `demo` \(0 active\)/);
    assert.match(text, /DD - Audit UI: http:\/\/127\.0\.0\.1:7733/);
    assert.doesNotMatch(text, /DeltaDictum/);
    store.close();
  });

  test('counts active atoms without listing the corpus', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom({
      id: 'atom-1',
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/admission/required-fields',
      tags: ['memory'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    });
    const payload = await buildSessionStartContext({
      store,
      projectId: 'demo',
      uiUrl: 'http://127.0.0.1:7733',
    });
    assert.match(payload.hookSpecificOutput.additionalContext, /DD - loaded for `demo` \(1 active\)/);
    store.close();
  });

  // `ui.json` outlives the process that wrote it, so a recorded URL is a claim
  // about the past. The person is only handed a link once something answered.
  test('the audit URL reaches the person only when the UI is live', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });

    const dark = await buildSessionStartContext({ store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733' });
    assert.equal(dark.systemMessage, undefined);
    assert.match(dark.hookSpecificOutput.additionalContext, /DD - Audit UI: http:\/\/127\.0\.0\.1:7733/);

    const live = await buildSessionStartContext({ store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', uiLive: true });
    assert.equal(live.systemMessage, 'DD audit UI: http://127.0.0.1:7733');
    assert.match(live.hookSpecificOutput.additionalContext, /DD - loaded for `demo`/);
    store.close();
  });

  test('a same-session reconnect gets the banner only, not the full advisory blob again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const opts = { store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 'sess-1' };
    const first = await buildSessionStartContext(opts);
    assert.match(first.hookSpecificOutput.additionalContext, /DD - Project context \(advisory\)/);

    const second = await buildSessionStartContext(opts);
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /DD - Project context \(advisory\)/);
    assert.match(second.hookSpecificOutput.additionalContext, /DD - loaded for `demo`/);
    store.close();
  });

  test('compact clears the reconnect dedup, so the full advisory is resent', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const base = { store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 'sess-2' };
    await buildSessionStartContext(base);
    const afterCompact = await buildSessionStartContext({ ...base, source: 'compact' });
    assert.match(afterCompact.hookSpecificOutput.additionalContext, /DD - Project context \(advisory\)/);
    store.close();
  });

  test('a different session_id always gets the full advisory, regardless of a prior session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const shared = { store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733' };
    await buildSessionStartContext({ ...shared, sessionId: 'sess-3' });
    const other = await buildSessionStartContext({ ...shared, sessionId: 'sess-4' });
    assert.match(other.hookSpecificOutput.additionalContext, /DD - Project context \(advisory\)/);
    store.close();
  });
});
