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
