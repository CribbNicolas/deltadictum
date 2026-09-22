import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { openStore } from '../../src/project.js';

// Roadmap gap 6: a data-directory move starts a fresh index. Atoms return from
// git, but telemetry stayed behind under the old path, silently.
test('a fresh data directory adopts telemetry left in an earlier location for the same project', async t => {
  const base = await mkdtemp(join(tmpdir(), 'dd-adopt-'));
  const repo = join(base, 'repo');
  await mkdir(join(repo, '.dd'), { recursive: true });
  await writeFile(join(repo, '.dd', 'config.json'), JSON.stringify({ project_id: 'demo' }));
  await writeFile(join(repo, 'package.json'), '{}');
  await mkdir(join(repo, '.git'));

  // An older build wrote its index under the repo (the Codex layout).
  const old = await createMemoryStore({ ddDir: join(repo, '.dd'), dataDir: join(repo, '.dd', 'local'), repoRoot: repo });
  await old.logRetrieval({ project_id: 'demo', action: 'edit-demo', returned_atom_ids: [], abstained: true, budget_used: 40 });
  await old.logRetrieval({ project_id: 'other', action: 'edit-other', returned_atom_ids: [], abstained: true, budget_used: 40 });
  old.close();

  const fresh = join(base, 'data-now');
  process.env.DD_DATA = fresh;
  process.env.DD_PROJECT_DIR = repo;
  t.after(() => { delete process.env.DD_DATA; delete process.env.DD_PROJECT_DIR; });
  const { store, adopted } = await openStore();
  const ids = store.index.db.prepare('SELECT action FROM memory_retrieval_events').all().map(r => r.action);
  assert.deepEqual(ids, ['edit-demo']);
  assert.deepEqual(adopted.map(a => [a.from, a.rows]), [[join(repo, '.dd', 'local'), 1]]);

  // Adoption happens once, when the index is created; reopening copies nothing.
  store.close();
  const again = await openStore();
  t.after(() => again.store.close());
  assert.deepEqual(again.adopted, []);
});
