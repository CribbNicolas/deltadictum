import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INDEX_VERSION, isStale, loadIndex, memoryFilesFingerprint, needsCompile, readBodies } from '../../../src/engine/index-file.cjs';
import { localPaths } from '../../../src/engine/locate.cjs';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-index-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const p = localPaths(root);
  mkdirSync(p.memories, { recursive: true });
  mkdirSync(p.v2, { recursive: true });
  writeFileSync(join(p.memories, 'm1.json'), '{"id":"m1"}');
  writeFileSync(p.manifest, JSON.stringify({ version: 1, count: 1, hash: 'h1' }));
  const index = { version: INDEX_VERSION, manifest: { count: 1, hash: 'h1' }, fingerprint: memoryFilesFingerprint(p.memories), bodies: 'bodies-t1.json', memories: {}, clauses: [] };
  writeFileSync(p.index, JSON.stringify(index));
  writeFileSync(join(p.v2, 'bodies-t1.json'), JSON.stringify({ m1: { body: 'b', evidence: [] } }));
  return { root, p };
}

test('a fresh index is not stale and loads with its bodies', t => {
  const { root } = project(t);
  const index = loadIndex(root);
  assert.equal(isStale(index, root), false);
  assert.equal(needsCompile(index, root), false);
  assert.deepEqual(readBodies(root, index), { m1: { body: 'b', evidence: [] } });
});

// The hot path must not read an index of another shape as this one: it is
// ignored, and session start recompiles it.
test('an index of another version does not load, and needs a compile', t => {
  const { root, p } = project(t);
  writeFileSync(p.index, JSON.stringify({ version: INDEX_VERSION - 1, manifest: { count: 1, hash: 'h1' }, memories: { m1: {} },
    clauses: [{ m: 'm1', on: ['read'], dims: ['paths'], paths: ['.*'] }] }));
  assert.equal(loadIndex(root), null);
  assert.equal(needsCompile(loadIndex(root), root), true);
});

test('bodies come only from the file the index names, inside the index folder', t => {
  const { root } = project(t);
  assert.equal(readBodies(root, null), null);
  assert.equal(readBodies(root, { bodies: undefined }), null);
  for (const name of ['../../memories/m1.json', 'bodies-t1.json/../x', 'index.json']) assert.equal(readBodies(root, { bodies: name }), null, name);
});

test('a missing or unreadable index, another version or a changed manifest is stale', t => {
  const { root, p } = project(t);
  assert.equal(isStale(null, root), true);
  writeFileSync(p.index, '{ torn');
  assert.equal(loadIndex(root), null);
  assert.equal(isStale({ version: INDEX_VERSION - 1, manifest: { hash: 'h1' } }, root), true);
  writeFileSync(p.manifest, JSON.stringify({ version: 1, count: 1, hash: 'h2' }));
  assert.equal(isStale({ version: INDEX_VERSION, manifest: { hash: 'h1' } }, root), true);
});

test('a memory file changed by hand or by git, with the manifest untouched, needs a compile at session start', t => {
  const { root, p } = project(t);
  const index = loadIndex(root);
  writeFileSync(join(p.memories, 'm1.json'), '{"id":"m1","edited":true}');
  utimesSync(join(p.memories, 'm1.json'), new Date(), new Date(Date.now() + 5000));
  assert.equal(isStale(index, root), false);
  assert.equal(needsCompile(index, root), true);
  const fresh = memoryFilesFingerprint(p.memories);
  writeFileSync(join(p.memories, 'm2.json'), '{}');
  assert.notEqual(memoryFilesFingerprint(p.memories), fresh);
});
