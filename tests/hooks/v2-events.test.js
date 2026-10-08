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

test('every tool DD listens to becomes an event with its full text', () => {
  assert.deepEqual(TOOL_EVENTS, ['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Bash', 'Grep', 'Glob']);
  const big = 'x'.repeat(5000);
  assert.deepEqual(toolEvent('Edit', { file_path: `${ROOT}\\src\\a.js`, old_string: 'a', new_string: big }, ROOT), { kind: 'edit', paths: ['src/a.js'], text: big });
  assert.deepEqual(toolEvent('Bash', { command: 'npm publish --dry-run' }, ROOT), { kind: 'run', paths: [], text: 'npm publish --dry-run' });
  assert.deepEqual(bashPaths('node --test tests/a.test.js', ROOT), ['tests/a.test.js']);
  assert.equal(toolEvent('WebFetch', { url: 'https://x' }, ROOT), null);
  assert.equal(toolEvent(undefined, {}, ROOT), null);
});
