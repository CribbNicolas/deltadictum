import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_TOOLS } from '../../../src/eval/agent/permissions.js';

// The 2026-10-14 trial refused 37 commands across the four conditions: pipes into
// grep or head, a cat of a module, npx eslint, a redirection into a log. The
// shell commands that inspect a tree are allowed, and the one npx invocation the
// agents used; a bare npx (it fetches and runs any package), find (-exec,
// -delete) and anything that reaches the network or deletes are not. node, npm
// and git were allowed before this list and stay: the suite and the checks need them.
test('the trial allow list covers the project tooling and the shell commands that inspect a tree, and no more', () => {
  for (const program of ['node', 'npm', 'git', 'cat', 'head', 'tail', 'sed', 'grep', 'rg', 'ls', 'wc', 'diff', 'echo', 'mkdir', 'cd', 'pwd', 'sort', 'uniq', 'tr', 'cut']) {
    assert.ok(ALLOWED_TOOLS.includes(`Bash(${program}:*)`), program);
  }
  assert.ok(ALLOWED_TOOLS.includes('Bash(npx eslint:*)'));
  for (const tool of ['Read', 'Edit', 'Write', 'Grep', 'Glob']) assert.ok(ALLOWED_TOOLS.includes(tool), tool);
  for (const forbidden of ['npx:', 'find', 'curl', 'wget', 'ssh', 'scp', 'rm', 'sudo', 'powershell', 'pwsh', 'bash', 'sh:', 'python', 'eval', 'xargs']) {
    assert.ok(!ALLOWED_TOOLS.some(rule => rule.startsWith(`Bash(${forbidden}`)), forbidden);
  }
});
