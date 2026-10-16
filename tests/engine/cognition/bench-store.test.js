import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { benchMemoryId, installStore, materializeMemories, writeGuide } from '../../../src/eval/bench/store.js';

const definition = (topic, over = {}) => ({ topic, kind: 'trap', title: `Rule ${topic}`, body: `Body of ${topic}.`, not_derivable: 'Hidden.',
  triggers: [{ on: ['read'], paths: ['src/a.go'] }], evidence: [{ path: 'src/a.go', summary: 'The file.' }], ...over });
const project = (over = {}) => ({ id: 'tg', store: 'bench', guideTarget: 'CLAUDE.md',
  memories: [definition('net/retry'), definition('net/old', { status: 'superseded' }), definition('net/new', { replaces: 'net/old', evidence: [{ path: 'missing.go', summary: 'Gone.' }] })], ...over });
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-bench-store-'));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.go'), 'package a\n');
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return root;
}

test('ids are stable per project and topic', () => {
  assert.equal(benchMemoryId('tg', 'net/retry'), benchMemoryId('tg', 'net/retry'));
  assert.notEqual(benchMemoryId('tg', 'net/retry'), benchMemoryId('lk', 'net/retry'));
  assert.match(benchMemoryId('tg', 'x'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('definitions become stored memories with hashed evidence; missing evidence is a warning', async t => {
  const root = repo(t);
  const { memories, warnings } = await materializeMemories(root, project());
  assert.equal(memories.length, 3);
  const retry = memories.find(m => m.topic === 'net/retry');
  assert.equal(retry.id, benchMemoryId('tg', 'net/retry'));
  assert.equal(retry.project_id, 'tg');
  assert.match(retry.evidence[0].sha256, /^[0-9a-f]{64}$/);
  assert.equal(memories.find(m => m.topic === 'net/old').status, 'superseded');
  assert.equal(memories.find(m => m.topic === 'net/new').replaces, benchMemoryId('tg', 'net/old'));
  assert.deepEqual(memories.find(m => m.topic === 'net/new').evidence, []);
  assert.deepEqual(warnings, ['net/new: evidence missing.go not found']);
});

test('installing a bench store replaces the clone\'s memories and compiles them', async t => {
  const root = repo(t);
  mkdirSync(join(root, '.dd', 'memories'), { recursive: true });
  writeFileSync(join(root, '.dd', 'memories', 'stale.json'), '{}');
  const out = await installStore(root, project());
  assert.ok(existsSync(join(root, '.dd', 'config.json')));
  assert.ok(!readdirSync(join(root, '.dd', 'memories')).includes('stale.json'));
  assert.equal(out.index_memories, 2);
  assert.ok(existsSync(join(root, '.dd', 'local', 'v2', 'index.json')));
});

test('the guide holds the live memories and is named in the guide target only when referenced', async t => {
  const root = repo(t);
  const { memories } = await materializeMemories(root, project());
  await writeGuide(root, project(), memories, false);
  const guide = readFileSync(join(root, 'docs', 'engineering-guide.md'), 'utf8');
  assert.match(guide, /### Rule net\/retry/);
  assert.doesNotMatch(guide, /### Rule net\/old/);
  assert.ok(!existsSync(join(root, 'CLAUDE.md')));
  await writeGuide(root, project(), memories, true);
  assert.match(readFileSync(join(root, 'CLAUDE.md'), 'utf8'), /docs\/engineering-guide\.md/);
});

test('a bench store starts from an empty .dd: v1 atoms and other leftovers do not stay', async t => {
  const root = repo(t);
  mkdirSync(join(root, '.dd', 'atoms'), { recursive: true });
  writeFileSync(join(root, '.dd', 'atoms', 'lesson.json'), '{}');
  writeFileSync(join(root, '.dd', 'relations.json'), '{}');
  await installStore(root, project());
  assert.ok(!existsSync(join(root, '.dd', 'atoms')));
  assert.ok(!existsSync(join(root, '.dd', 'relations.json')));
});
