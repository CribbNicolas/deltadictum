import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../../src/store/create-store.js';
import { orientProject, projectContext } from '../../../src/engine/project-context.js';
import { estimateTokens } from '../../../src/engine/budget.js';

test('orientation derives cited manifest facts, respects budget and refreshes after change', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-orient-'));
  const path = join(root, 'package.json');
  await writeFile(path, JSON.stringify({ name: 'example', description: 'Example payment system.', type: 'module', scripts: { test: 'node --test' } }));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  t.after(() => store.close());
  const map = await projectContext(store);
  assert.equal(map.facts['package.type'], 'module');
  assert.deepEqual(map.sources, ['package.json']);
  assert.equal(map.commands.test, 'npm run test');
  const small = await orientProject({ budget_tokens: 128 }, { store, projectId: 'demo' });
  assert.ok(estimateTokens(small) <= 128);
  await writeFile(path, JSON.stringify({ name: 'example', type: 'commonjs' }));
  assert.equal((await projectContext(store)).facts['package.type'], 'commonjs');
});

test('the project-context cache survives across store instances, not just within one', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-orient-cache-'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'example', type: 'module' }));
  const ddDir = join(root, '.dd');
  const dataDir = join(root, 'data');

  const first = await createMemoryStore({ ddDir, dataDir });
  await projectContext(first);
  first.close();

  // A brand-new store instance against the same data dir is what every ephemeral
  // PreToolUse hook actually opens; the cache must be visible there without
  // recomputing, not just within the process that first wrote it.
  const second = await createMemoryStore({ ddDir, dataDir });
  t.after(() => second.close());
  const cached = second.index.getMeta('project_context');
  assert.ok(cached, 'expected a project_context row to persist for a fresh store instance to read');
  assert.equal(JSON.parse(cached).value.facts['package.type'], 'module');
});
