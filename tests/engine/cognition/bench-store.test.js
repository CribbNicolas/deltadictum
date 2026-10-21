import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { benchMemories, benchMemoryId, installStore, materializeMemories, writeGuide } from '../../../src/eval/bench/store.js';

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
  assert.ok(existsSync(join(root, '.dd', 'local', 'compiled', 'index.json')));
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

test('a bench store starts from an empty .dd: leftovers of another layout do not stay', async t => {
  const root = repo(t);
  mkdirSync(join(root, '.dd', 'old'), { recursive: true });
  writeFileSync(join(root, '.dd', 'old', 'x.json'), '{}');
  writeFileSync(join(root, '.dd', 'leftover.json'), '{}');
  await installStore(root, project());
  assert.ok(!existsSync(join(root, '.dd', 'old')));
  assert.ok(!existsSync(join(root, '.dd', 'leftover.json')));
});

test('a definition\'s check reaches the stored memory', async t => {
  const root = repo(t);
  const check = { on: ['edit'], paths: ['src/**/*.go'], if_content: 'os\\.Rename\\(', say: 'Use fsx.ReplaceFile.', examples: { violates: 'os.Rename(a, b)', passes: 'fsx.ReplaceFile(a, b)' } };
  const { memories } = await materializeMemories(root, project({ memories: [definition('net/retry', { check })] }));
  assert.deepEqual(memories[0].check, check);
});

test('the compiler\'s warnings come back from installing a store', async t => {
  const root = repo(t);
  const check = { on: ['edit'], paths: ['src/**/*.go'], if_content: 'os\\.Rename\\(', say: 'Use fsx.ReplaceFile.', examples: { violates: 'fsx.ReplaceFile(a, b)', passes: 'os.Rename(a, b)' } };
  const out = await installStore(root, project({ memories: [definition('net/retry', { check })] }));
  assert.ok(out.compile_warnings.some(w => w.kind === 'check_examples_fail'), JSON.stringify(out.compile_warnings));
});

test('bench memories without a clone carry the ids, triggers and checks the store gets', async t => {
  const root = repo(t);
  const p = project({ memories: [...project().memories, definition('net/checked', { check: { when: 'turn', if_content: 'x', violates: ['x'], passes: ['y'] } })] });
  const stored = (await materializeMemories(root, p)).memories;
  const pure = benchMemories(p);
  const shape = m => [m.id, m.topic, m.status, JSON.stringify(m.triggers), JSON.stringify(m.check ?? null), m.replaces];
  assert.deepEqual(pure.map(shape), stored.map(shape));
  assert.ok(pure.every(m => Array.isArray(m.evidence) && m.evidence.length === 0));
  const existing = { id: 'pa', store: 'existing', memories: [{ id: 'own', topic: 'x' }] };
  assert.equal(benchMemories(existing), existing.memories);
});
