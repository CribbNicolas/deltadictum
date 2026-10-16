import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShipped, needsRelease } from '../../.github/scripts/version-rule.mjs';

const FILES = ['src', '!src/eval', '.claude-plugin', 'docs/DD.md', 'docs/guide', 'skills', 'LICENSE', 'npm-shrinkwrap.json'];

test('a path ships when an entry of files covers it and no exclusion does', () => {
  assert.equal(isShipped('src/hooks/v2/hook.cjs', FILES), true);
  assert.equal(isShipped('src/eval/agent/summary.js', FILES), false);
  assert.equal(isShipped('docs/guide/how-it-works.md', FILES), true);
  assert.equal(isShipped('docs/getting-started.md', FILES), false);
  assert.equal(isShipped('docs/DD.md', FILES), true);
  assert.equal(isShipped('srcx/file.js', FILES), false);
});

test('npm always packs package.json, the README and the licence', () => {
  assert.equal(isShipped('package.json', FILES), true);
  assert.equal(isShipped('README.md', FILES), true);
  assert.equal(isShipped('LICENSE', FILES), true);
});

test('a change set needs a release only when something in it ships', () => {
  assert.equal(needsRelease(['site/src/pages/index.astro', 'docs/getting-started.md', '.github/workflows/site.yml', 'tests/repo/x.test.js'], FILES), false);
  assert.equal(needsRelease(['site/package.json', 'docs/guide/memories.md'], FILES), true);
  // A deleted shipped file is still a change to the package.
  assert.equal(needsRelease(['docs/guide/removed-page.md'], FILES), true);
  assert.equal(needsRelease([], FILES), false);
});

test('a file moved out of the package counts at its old path too', async t => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { changedFiles } = await import('../../.github/scripts/version-rule.mjs');
  const repo = mkdtempSync(join(tmpdir(), 'dd-version-'));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  mkdirSync(join(repo, 'docs', 'guide'), { recursive: true });
  writeFileSync(join(repo, 'docs', 'guide', 'storage.md'), 'Everything DD keeps for a project lives in its .dd/ folder.\n'.repeat(20));
  git('add', '.');
  git('commit', '-q', '-m', 'base');
  git('checkout', '-q', '-b', 'move');
  git('mv', 'docs/guide/storage.md', 'docs/storage.md');
  git('commit', '-q', '-m', 'move');
  const changed = changedFiles('main', { cwd: repo });
  assert.deepEqual(changed.sort(), ['docs/guide/storage.md', 'docs/storage.md']);
  assert.equal(needsRelease(changed, ['docs/guide']), true);
});
