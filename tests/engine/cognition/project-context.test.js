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
