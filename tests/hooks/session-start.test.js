import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { buildSessionStartContext } from '../../src/hooks/session-start.js';
import { PROVENANCE } from '../helpers/atom.js';

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
      why: 'Stops unstructured dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/admission/required-fields',
      tags: ['memory'],
      ...PROVENANCE, lifecycle_state: 'active',
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

  // A recorded URL is a claim about the past. The person is only handed a link once something answered.
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
    // Pushed knowledge made pulling look redundant; the start says when to pull.
    assert.match(first.hookSpecificOutput.additionalContext, /`retrieve` tool before changing an area.*`propose`.*load them first/s);

    const second = await buildSessionStartContext(opts);
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /DD - Project context \(advisory\)/);
    assert.doesNotMatch(second.hookSpecificOutput.additionalContext, /`retrieve` tool/);
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

  // Past the threshold the archive is worth a cleanup; the session start offers /dd:clean.
  test('an archive past its review threshold prompts a cleanup once per session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-session-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    try {
    for (const id of ['z1', 'z2']) {
      await store.putAtom({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project', title: `T ${id}`, trigger: `when ${id}`,
        behavior_delta: `Do ${id}.`, what: 'W.', why: 'Y.', authority: 'inferred', confidence: 0.5, valid_from: '2026-09-09T00:00:00.000Z',
        topic_key: `demo/archive/${id}`, tags: [], ...PROVENANCE, lifecycle_state: 'archived', archived_reason: 'Unused.' });
    }
    await store.saveConfig({ ...(await store.loadConfig()), archive_review_at: 1 });
    const due = await buildSessionStartContext({ store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 'arc-1' });
    assert.match(due.hookSpecificOutput.additionalContext, /The archive holds 2 memories \(review at 1\)\. Offer the user \/dd:clean/);
    const again = await buildSessionStartContext({ store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 'arc-1' });
    assert.doesNotMatch(again.hookSpecificOutput.additionalContext, /The archive holds/);
    await store.saveConfig({ ...(await store.loadConfig()), archive_review_at: 5 });
    const quiet = await buildSessionStartContext({ store, projectId: 'demo', uiUrl: 'http://127.0.0.1:7733', sessionId: 'arc-2' });
    assert.doesNotMatch(quiet.hookSpecificOutput.additionalContext, /The archive holds/);
    } finally { store.close(); }
  });
});
