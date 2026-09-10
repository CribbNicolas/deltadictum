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
});
