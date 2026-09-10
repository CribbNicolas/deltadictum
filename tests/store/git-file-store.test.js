import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitFileStore } from '../../src/store/git-file-store.js';
import { atomFilePath, DEFAULT_CONFIG } from '../../src/store/paths.js';

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
    tags: ['memory'],
    lifecycle_state: 'active',
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'Admission gate' }],
    ...overrides,
  };
}

describe('GitFileStore', () => {
  test('round-trips an atom to a nested json file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    const stored = await store.putAtom(atom());
    assert.equal(stored.topic_key, 'memory/admission/required-fields');
    const disk = JSON.parse(await readFile(atomFilePath(root, stored.topic_key), 'utf8'));
    assert.equal(disk.id, 'atom-1');
    const loaded = await store.getAtom('atom-1', 'demo');
    assert.equal(loaded.title, 'Require trigger');
    const byKey = await store.getAtom('memory/admission/required-fields', 'demo');
    assert.equal(byKey.id, 'atom-1');
  });

  test('enforces live topic uniqueness across different ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    await assert.rejects(
      () => store.putAtom(atom({ id: 'atom-2' })),
      /live_topic_conflict/,
    );
  });

  test('allows updating the same live atom', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    const updated = await store.putAtom(atom({ what: 'Updated what' }));
    assert.equal(updated.what, 'Updated what');
    const all = await store.listAtoms({ projectId: 'demo' });
    assert.equal(all.length, 1);
  });

  test('does not leak another project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    await store.putAtom(atom({
      id: 'atom-other',
      project_id: 'other',
      topic_key: 'memory/other/topic',
    }));
    const demo = await store.listAtoms({ projectId: 'demo' });
    assert.equal(demo.length, 1);
    assert.equal(demo[0].project_id, 'demo');
  });

  test('default config uses the 0.02 vpt threshold', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    const config = await store.loadConfig();
    assert.equal(DEFAULT_CONFIG.vpt_threshold, 0.02);
    assert.equal(config.vpt_threshold, 0.02);
  });

  test('looks up a live atom by topic_key without listing the corpus', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    for (let i = 0; i < 40; i += 1) {
      await store.putAtom(atom({
        id: `filler-${i}`,
        topic_key: `synth/load/item-${i}`,
        title: `Filler ${i}`,
      }));
    }
    const loaded = await store.getAtom('memory/admission/required-fields', 'demo');
    assert.equal(loaded.id, 'atom-1');
    await assert.rejects(
      () => store.putAtom(atom({ id: 'atom-2' })),
      /live_topic_conflict/,
    );
  });

  test('rejects path traversal in topic_key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-git-'));
    const store = createGitFileStore(root);
    await assert.rejects(
      () => store.putAtom(atom({ topic_key: '../../etc/passwd' })),
      /invalid_topic_key/,
    );
  });
});
