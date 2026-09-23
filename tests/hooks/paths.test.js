import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizePath, samePath } from '../../src/hooks/build.js';
import { openStore } from '../../src/project.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';
import { startUiServer } from '../../src/ui/server.js';
import { registerResident } from '../helpers/resident.js';
import { callRunningStore } from '../../src/hooks/bridge.js';

// One project reached by two spellings: through a symlink (macOS /tmp and /var
// are symlinks to /private; projects often live behind one) and by its physical
// path, which is what process.cwd() returns. Case differs on Windows and on
// macOS's default case-insensitive volumes. Every process must agree it is one
// project and one build.
async function linkedProject() {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'dd-paths-')));
  const target = join(base, 'Real Project');
  await mkdir(join(target, '.git'), { recursive: true });
  await mkdir(join(target, 'src', 'domain'), { recursive: true });
  await writeFile(join(target, 'README.md'), 'Layers.');
  const link = join(base, 'linked');
  await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  return { base, target, link };
}

test('a symlinked path and its target normalize to one path', async () => {
  const { target, link } = await linkedProject();
  assert.equal(normalizePath(link), normalizePath(target));
  assert.ok(samePath(link, target));
  assert.ok(samePath(join(link, 'missing', 'file.js'), join(target, 'missing', 'file.js')));
  if (process.platform === 'win32' || process.platform === 'darwin') assert.ok(samePath(target.toUpperCase(), target));
});

test('opening the project by either spelling reaches the same data directory', async t => {
  const { base, target, link } = await linkedProject();
  const previous = { ...process.env };
  delete process.env.DD_DATA;
  process.env.CLAUDE_PLUGIN_DATA = join(base, 'plugin-data');
  t.after(() => { process.env = previous; });
  const viaLink = await openStore({ cwd: link });
  viaLink.store.close();
  const viaTarget = await openStore({ cwd: target });
  viaTarget.store.close();
  assert.equal(viaLink.dataDir, viaTarget.dataDir);
});

test('a file given by its physical path still matches a scope under a symlinked root', async t => {
  const { target, link } = await linkedProject();
  const store = await createMemoryStore({ ddDir: join(link, '.dd'), dataDir: join(link, 'data'), repoRoot: link });
  t.after(() => store.close());
  const proposed = await proposeMemory({ project_id: 'demo', memory_type: 'decision', topic_key: 'architecture/core/layers',
    trigger: 'when changing domain rules', behavior_delta: 'Keep rules in domain.', why: 'Layers stay testable.',
    applies_to: { files: ['src/domain/**'] }, evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'Layers' }] }, { store });
  await admitMemory(proposed.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Documented.' });
  const file = join(target, 'src', 'domain', 'Rules.cs');
  const result = await retrieveMemories({ project_id: 'demo', action: `Edit ${file}`, files: [file], operation: 'edit', telemetry: false }, { store });
  assert.equal(result.memories.length, 1);
});

test('a hook sending one spelling is answered by a resident started with the other', async t => {
  const { target, link } = await linkedProject();
  const store = await createMemoryStore({ ddDir: join(target, '.dd'), dataDir: join(target, 'data'), repoRoot: target });
  const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await registerResident(t, ui);
  assert.notEqual(await callRunningStore('session-start', { session_id: 's' }, link), null);
});
