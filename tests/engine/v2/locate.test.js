import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findProjectRoot, localPaths } from '../../../src/engine/locate.cjs';

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dd-locate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('the project root is the nearest folder holding .dd/memories or .git', t => {
  const root = scratch(t);
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  assert.equal(findProjectRoot(join(root, 'a', 'b'), { stopAt: tmpdir() }), root);
  const inner = join(root, 'pkg');
  mkdirSync(join(inner, '.dd', 'memories'), { recursive: true });
  assert.equal(findProjectRoot(join(inner), { stopAt: tmpdir() }), inner);
});

test('without a marker below the stop folder, the start folder is the root', t => {
  const root = scratch(t);
  mkdirSync(join(root, 'x'));
  assert.equal(findProjectRoot(join(root, 'x'), { stopAt: root }), join(root, 'x'));
});

test('local files live under .dd/local', () => {
  const p = localPaths('R');
  assert.equal(p.memories, join('R', '.dd', 'memories'));
  assert.equal(p.manifest, join('R', '.dd', 'memories', 'manifest.json'));
  assert.equal(p.index, join('R', '.dd', 'local', 'v2', 'index.json'));
  assert.equal(p.bodies, join('R', '.dd', 'local', 'v2', 'bodies.json'));
  assert.equal(p.sessions, join('R', '.dd', 'local', 'sessions'));
});
