import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { buildPreToolContext } from '../../src/hooks/pre-tool.js';
import { PROVENANCE } from '../helpers/atom.js';

describe('PreToolUse retrieve inject', () => {
  test('skips dd tools and injects compact hits for other tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-pretool-'));
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
      tags: [],
      ...PROVENANCE, lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    });

    const skip = await buildPreToolContext({ toolName: 'dd__retrieve' }, { store, projectId: 'demo' });
    assert.equal(skip.decision, 'allow');
    assert.equal(skip.hookSpecificOutput, undefined);

    const hit = await buildPreToolContext({
      toolName: 'search_replace',
      toolInput: { file_path: 'src/engine/write.js', old_string: 'before writing durable memory' },
    }, { store, projectId: 'demo' });
    assert.equal(hit.decision, 'allow');
    assert.match(hit.hookSpecificOutput.additionalContext, /Require trigger|Validate trigger/);
    assert.equal(hit.hookSpecificOutput.hookEventName, 'PreToolUse');
    store.close();
  });
});
