import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bashPaths, relativize, toolEvent, TOOL_EVENTS } from '../../src/hooks/v2/events.cjs';

const ROOT = 'C:\\work\\project';

test('Claude Code paths become repository-relative, whatever their case or slashes', () => {
  assert.equal(relativize('C:\\work\\project\\src\\a.js', ROOT), 'src/a.js');
  assert.equal(relativize('c:/WORK/project/src/a.js', ROOT), 'src/a.js');
  assert.equal(relativize('C:\\work\\project', ROOT), '.');
  assert.equal(relativize('D:\\other\\b.js', ROOT), 'D:/other/b.js');
});

// Claude Code may start in a monorepo folder, and Bash keeps its folder after a cd:
// a relative path means the session's folder, not the repository root.
test('relative paths in a command, a search or a read are resolved from the session folder', () => {
  const api = `${ROOT}\\packages\\api`;
  assert.deepEqual(bashPaths('node --test tests/x.test.js ../shared/y.js', ROOT, api), ['packages/api/tests/x.test.js', 'packages/shared/y.js']);
  assert.deepEqual(toolEvent('Grep', { pattern: 'x', path: 'src' }, ROOT, api).paths, ['packages/api/src']);
  assert.deepEqual(toolEvent('Read', { file_path: 'src/a.js' }, ROOT, api).paths, ['packages/api/src/a.js']);
  assert.deepEqual(toolEvent('Read', { file_path: `${ROOT}\\src\\a.js` }, ROOT, api).paths, ['src/a.js']);
  assert.deepEqual(bashPaths('cat ./a.js', ROOT), ['a.js']);
});

test('every tool DD listens to becomes an event with its full text', () => {
  assert.deepEqual(TOOL_EVENTS, ['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Bash', 'Grep', 'Glob']);
  const big = 'x'.repeat(5000);
  assert.deepEqual(toolEvent('Edit', { file_path: `${ROOT}\\src\\a.js`, old_string: 'a', new_string: big }, ROOT), { kind: 'edit', paths: ['src/a.js'], text: big });
  assert.deepEqual(toolEvent('Bash', { command: 'npm publish --dry-run' }, ROOT), { kind: 'run', paths: [], text: 'npm publish --dry-run' });
  assert.deepEqual(bashPaths('node --test tests/a.test.js', ROOT), ['tests/a.test.js']);
  assert.equal(toolEvent('WebFetch', { url: 'https://x' }, ROOT), null);
  assert.equal(toolEvent(undefined, {}, ROOT), null);
});
