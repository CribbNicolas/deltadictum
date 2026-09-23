import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { openStore } from '../../src/project.js';

function atom(id) { return { id, project_id: 'demo', topic_key: `test/topic/${id}`, memory_type: 'lesson', scope: 'project',
  title: id, trigger: 'writing tests', behavior_delta: 'Check the result.', what: 'Check the result.', why: 'Regression.',
  lifecycle_state: 'active', valid_from: new Date().toISOString(), retrieval_forms: { micro: 'Check.' } }; }

test('interrupted committed Git transaction is recovered before readers open the index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-recovery-'));
  const ddDir = join(root, '.dd');
  await mkdir(ddDir);
  await writeFile(join(ddDir, '.pending-write.json'), JSON.stringify({ version: 1, operations: [
    { path: 'atoms/test/topic/recovered.json', value: { ...atom('recovered'), created_at: new Date().toISOString(), updated_at: new Date().toISOString() } },
  ] }));
  const store = await createMemoryStore({ ddDir, dataDir: join(root, 'data') });
  assert.equal((await store.getAtom('recovered', 'demo')).lifecycle_state, 'active');
  store.close();
});

test('independent store instances serialize registry writes and preserve both updates', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-concurrent-'));
  const opts = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  const a = await createMemoryStore(opts);
  const b = await createMemoryStore(opts);
  await Promise.all([a.createRegistryEntry('demo', 'test/first/topic', 'provisional'), b.createRegistryEntry('demo', 'test/second/topic', 'provisional')]);
  await a.refresh();
  assert.ok(await a.getRegistryEntryByKey('demo', 'test/first/topic'));
  assert.ok(await a.getRegistryEntryByKey('demo', 'test/second/topic'));
  a.close(); b.close();
});

test('parallel first open assigns one project identity and preserves existing ignore policies', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-project-'));
  const prior = process.env.DD_DATA;
  process.env.DD_DATA = join(root, 'data');
  const opened = [];
  t.after(() => { for (const entry of opened) entry.store.close();
    if (prior === undefined) delete process.env.DD_DATA; else process.env.DD_DATA = prior; });
  opened.push(...await Promise.all([openStore({ cwd: root }), openStore({ cwd: root })]));
  assert.equal(opened[0].projectId, opened[1].projectId);
  const ignore = join(root, '.dd', '.gitignore');
  assert.match(await readFile(ignore, 'utf8'), /\.write-lock/);
  await writeFile(ignore, 'my-runtime.log\n');
  opened.push(await openStore({ cwd: root }));
  assert.equal(await readFile(ignore, 'utf8'), 'my-runtime.log\n');
});
