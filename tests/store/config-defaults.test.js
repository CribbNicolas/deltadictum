import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';

async function storeWith(t, config) {
  const root = await mkdtemp(join(tmpdir(), 'dd-config-'));
  await mkdir(join(root, '.dd'), { recursive: true });
  await writeFile(join(root, '.dd', 'config.json'), JSON.stringify(config));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => store.close());
  return store;
}

// Every project wrote the defaults of its day into config.json, so a better
// default never reached it. A value equal to an old default in a config written
// before defaults were versioned is read as unset.
test('an old default written into an unversioned config gives way to the current default', async t => {
  const config = await (await storeWith(t, { project_id: 'p', budget_tokens: 600, semantic: { floor: 0.04 } })).loadConfig();
  assert.equal(config.budget_tokens, 800);
  assert.equal(config.semantic.floor, 0.035);
});

test('a value chosen in a versioned config is kept, even when it equals an old default', async t => {
  const config = await (await storeWith(t, { project_id: 'p', defaults_version: 2, budget_tokens: 600, semantic: { floor: 0.04 } })).loadConfig();
  assert.equal(config.budget_tokens, 600);
  assert.equal(config.semantic.floor, 0.04);
});

test('a non-default value in an unversioned config is kept', async t => {
  const config = await (await storeWith(t, { project_id: 'p', budget_tokens: 1200 })).loadConfig();
  assert.equal(config.budget_tokens, 1200);
});
