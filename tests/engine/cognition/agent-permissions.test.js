import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_TOOLS } from '../../../src/eval/agent/permissions.js';

// The 2026-10-14 trial refused 37 commands across the four conditions: pipes into
// grep or head, a cat of a module, npx eslint, a redirection into a log. Every
// family the agents reached for to inspect the tree or run the project's own
// tooling is allowed; nothing that reaches outside the clone is.
test('the trial allow list covers the project tooling and the shell commands that inspect a tree', () => {
  for (const program of ['node', 'npm', 'npx', 'git', 'cat', 'head', 'tail', 'sed', 'grep', 'rg', 'ls', 'find', 'wc', 'diff', 'echo', 'mkdir', 'cd', 'pwd', 'sort', 'uniq', 'tr', 'cut']) {
    assert.ok(ALLOWED_TOOLS.includes(`Bash(${program}:*)`), program);
  }
  for (const tool of ['Read', 'Edit', 'Write', 'Grep', 'Glob']) assert.ok(ALLOWED_TOOLS.includes(tool), tool);
  for (const forbidden of ['curl', 'wget', 'ssh', 'rm', 'sudo', 'powershell', 'python']) {
    assert.ok(!ALLOWED_TOOLS.some(rule => rule.startsWith(`Bash(${forbidden}`)), forbidden);
  }
});
