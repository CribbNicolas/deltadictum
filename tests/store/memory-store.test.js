import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryFiles, manifestOf } from '../../src/memory/store.js';
import { serializeMemory } from '../../src/memory/schema.js';

const memory = (id, over = {}) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title: `Memory ${id}`,
  body: 'Do the thing.\n\nWhy: it broke.', not_derivable: 'Only visible when it fails.',
  triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [], origin: 'model_initiated', replaces: null,
  revisit_when: [], review: { migrated: false, issues: [] },
  created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', ...over,
});
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dd-memories-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, store: createMemoryFiles(dir) };
}

test('a memory is written as ordered JSON and read back', async t => {
  const { dir, store } = scratch(t);
  const [stored] = await store.commit({ put: [memory('m1')] });
  assert.equal(readFileSync(join(dir, 'memories', 'm1.json'), 'utf8'), serializeMemory(stored));
  assert.deepEqual((await store.list()).map(m => m.id), ['m1']);
  assert.equal((await store.get('m1')).title, 'Memory m1');
  assert.equal(await store.get('missing'), null);
  assert.deepEqual(await store.list({ statuses: ['candidate'] }), []);
});

test('an invalid memory is refused before anything is written', async t => {
  const { dir, store } = scratch(t);
  await assert.rejects(store.commit({ put: [memory('m1'), memory('m2', { kind: 'lesson' })] }), /memory_invalid:m2:invalid_kind/);
  assert.equal(existsSync(join(dir, 'memories', 'm1.json')), false);
});

test('two live memories cannot share a topic, and a revision supersedes atomically', async t => {
  const { store } = scratch(t);
  await store.commit({ put: [memory('a', { topic: 'testing/same' })] });
  await assert.rejects(store.commit({ put: [memory('b', { topic: 'testing/same' })] }), /live_topic_conflict:testing\/same/);
  const old = await store.get('a');
  await store.commit({ put: [memory('b', { topic: 'testing/same', replaces: 'a' }), { ...old, status: 'superseded' }] });
  assert.deepEqual((await store.list({ statuses: ['active'] })).map(m => m.id), ['b']);
  assert.equal((await store.get('a')).status, 'superseded');
});

test('removal deletes the file and the manifest follows every commit', async t => {
  const { dir, store } = scratch(t);
  await store.commit({ put: [memory('m1'), memory('m2')] });
  const first = await store.manifest();
  assert.equal(first.count, 2);
  assert.deepEqual(first, manifestOf(await store.list()));
  await store.commit({ remove: ['m1'] });
  const second = await store.manifest();
  assert.equal(second.count, 1);
  assert.notEqual(second.hash, first.hash);
  assert.equal(existsSync(join(dir, 'memories', 'm1.json')), false);
});

test('a file that is not JSON or not a valid memory is reported, not thrown', async t => {
  const { dir, store } = scratch(t);
  await store.commit({ put: [memory('good')] });
  mkdirSync(join(dir, 'memories'), { recursive: true });
  writeFileSync(join(dir, 'memories', 'broken.json'), '{ not json');
  writeFileSync(join(dir, 'memories', 'odd.json'), JSON.stringify(memory('odd', { status: 'legacy' })));
  assert.deepEqual((await store.list()).map(m => m.id), ['good']);
  assert.deepEqual((await store.unsupported()).sort((a, b) => a.path.localeCompare(b.path)), [
    { path: 'memories/broken.json', id: null, reasons: ['invalid_json'] },
    { path: 'memories/odd.json', id: 'odd', reasons: ['invalid_status'] },
  ]);
});

test('a rewrite keeps the creation date and moves the update date, unless dates are preserved', async t => {
  const { store } = scratch(t);
  await store.commit({ put: [memory('m1')] });
  const [rewritten] = await store.commit({ put: [{ ...memory('m1'), title: 'Renamed', created: '2030-01-01T00:00:00.000Z' }] });
  assert.equal(rewritten.created, '2026-09-01T00:00:00.000Z');
  assert.notEqual(rewritten.updated, '2026-09-01T00:00:00.000Z');
  const [kept] = await store.commit({ put: [memory('m2')], preserveDates: true });
  assert.equal(kept.updated, '2026-09-01T00:00:00.000Z');
});

test('concurrent commits both land, serialized by the write lock', async t => {
  const { store } = scratch(t);
  await Promise.all([store.commit({ put: [memory('x1')] }), store.commit({ put: [memory('x2')] })]);
  assert.deepEqual((await store.list()).map(m => m.id).sort(), ['x1', 'x2']);
  assert.equal((await store.manifest()).count, 2);
});
