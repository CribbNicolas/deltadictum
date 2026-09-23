import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitFileStore } from '../../src/store/git-file-store.js';
import { atomFilePath, candidateFilePath, DEFAULT_CONFIG } from '../../src/store/paths.js';
import { PROVENANCE } from '../helpers/atom.js';

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
    why: 'Stops unstructured dumps.',
    authority: 'inferred',
    confidence: 0.8,
    valid_from: '2026-09-09T00:00:00.000Z',
    topic_key: 'memory/admission/required-fields',
    tags: ['memory'],
    ...PROVENANCE, lifecycle_state: 'active',
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'Admission gate' }],
    ...overrides,
  };
}

describe('GitFileStore', () => {
  test('round-trips an atom to a nested json file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    const stored = await store.putAtom(atom());
    assert.equal(stored.topic_key, 'memory/admission/required-fields');
    const disk = JSON.parse(await readFile(atomFilePath(root, stored.topic_key), 'utf8'));
    assert.equal(disk.id, 'atom-1');
    const [loaded] = await store.listAtoms({ projectId: 'demo' });
    assert.equal(loaded.title, 'Require trigger');
  });

  test('enforces live topic uniqueness across different ids', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    await assert.rejects(
      () => store.putAtom(atom({ id: 'atom-2' })),
      /live_topic_conflict/,
    );
  });

  test('allows updating the same live atom', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    const updated = await store.putAtom(atom({ what: 'Updated what' }));
    assert.equal(updated.what, 'Updated what');
    const all = await store.listAtoms({ projectId: 'demo' });
    assert.equal(all.length, 1);
  });

  test('does not leak another project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
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
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    const config = await store.loadConfig();
    assert.equal(DEFAULT_CONFIG.vpt_threshold, 0.02);
    assert.equal(config.vpt_threshold, 0.02);
  });

  // Only the current schema is read; nothing is defaulted or guessed. What is
  // refused is reported, never silently dropped, and never breaks the read.
  test('refuses atoms it cannot read and reports each with its reason', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    await store.putAtom(atom());
    const { schema_version, capture_origin, capture_source, ...bare } = atom();
    const files = {
      'no-version': { ...bare, capture_origin, capture_source },
      'old-version': { ...bare, schema_version: 6, capture_origin, capture_source },
      'no-origin': { ...bare, schema_version, capture_source },
      'no-source': { ...bare, schema_version, capture_origin },
    };
    await mkdir(join(root, 'candidates'), { recursive: true });
    for (const [id, value] of Object.entries(files)) {
      await writeFile(candidateFilePath(root, id), JSON.stringify({ ...value, id, lifecycle_state: 'candidate' }));
    }
    await writeFile(candidateFilePath(root, 'broken'), '{ not json');
    assert.deepEqual((await store.listAtoms()).map(a => a.id), ['atom-1']);
    const reasons = Object.fromEntries((await store.listUnsupported()).map(u => [u.path, u.reason]));
    assert.deepEqual(reasons, {
      'candidates/no-version.json': 'unsupported_schema_version',
      'candidates/old-version.json': 'unsupported_schema_version',
      'candidates/no-origin.json': 'invalid_capture_origin',
      'candidates/no-source.json': 'invalid_capture_source',
      'candidates/broken.json': 'invalid_json',
    });
  });

  test('writes always carry the current schema and complete provenance', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    const stored = await store.putAtom(atom({ schema_version: 6 }));
    assert.equal(stored.schema_version, PROVENANCE.schema_version);
    await assert.rejects(() => store.putAtom(atom({ id: 'atom-2', topic_key: 'memory/x/y', capture_origin: undefined })),
      /atom_unsupported:invalid_capture_origin/);
  });

  test('a live topic held by an unreadable file is not silently overwritten', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    const path = atomFilePath(root, atom().topic_key);
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, JSON.stringify({ ...atom({ id: 'old' }), schema_version: 6 }));
    await assert.rejects(() => store.putAtom(atom()), /live_topic_unsupported/);
  });

  test('rejects path traversal in topic_key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-git-'));
    const store = createGitFileStore(root);
    await assert.rejects(
      () => store.putAtom(atom({ topic_key: '../../etc/passwd' })),
      /invalid_topic_key/,
    );
  });
});
