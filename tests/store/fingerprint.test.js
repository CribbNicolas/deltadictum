import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { sourceFingerprint } from '../../src/store/fingerprint.js';

function atom(overrides = {}) {
  return {
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
    tags: [],
    lifecycle_state: 'active',
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    ...overrides,
  };
}

describe('source fingerprint reindex skip', () => {
  test('unchanged git source keeps the fingerprint and a git-only new file is picked up on reopen', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-fp-'));
    const supermemDir = join(root, '.supermem');
    const dataDir = join(root, 'data');
    const first = await createMemoryStore({ supermemDir, dataDir });
    await first.putAtom(atom());
    const fp = first.index.getMeta('source_fingerprint');
    assert.ok(fp);
    assert.equal(fp, await sourceFingerprint(supermemDir));
    first.close();

    const second = await createMemoryStore({ supermemDir, dataDir });
    assert.equal(second.index.getMeta('source_fingerprint'), fp);
    assert.equal((await second.getAtom('atom-1', 'demo')).title, 'Require trigger');
    second.close();

    const extraDir = join(supermemDir, 'atoms', 'memory', 'other');
    await mkdir(extraDir, { recursive: true });
    await writeFile(join(extraDir, 'topic.json'), `${JSON.stringify({
      ...atom({
        id: 'atom-2',
        topic_key: 'memory/other/topic',
        title: 'Other topic',
      }),
      created_at: '2026-09-10T00:00:00.000Z',
      updated_at: '2026-09-10T00:00:00.000Z',
    }, null, 2)}\n`);

    const third = await createMemoryStore({ supermemDir, dataDir });
    assert.notEqual(third.index.getMeta('source_fingerprint'), fp);
    assert.equal((await third.getAtom('atom-2', 'demo')).title, 'Other topic');
    third.close();
  });
});
