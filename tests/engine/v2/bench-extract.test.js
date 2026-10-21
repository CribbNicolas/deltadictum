import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedByFile, bashPaths, relativize, streamEvents, toolEvent } from '../../../src/eval/v2bench/extract.js';

const CWD = 'C:\\Users\\dev\\AppData\\Local\\Temp\\dd-agent-AbC123\\supermem';

test('paths under the run directory become repository-relative', () => {
  assert.equal(relativize(`${CWD}\\src\\store\\paths.js`, CWD), 'src/store/paths.js');
  assert.equal(relativize('C:/users/dev/appdata/local/temp/dd-agent-AbC123/supermem/package.json', CWD), 'package.json');
  assert.equal(relativize('./tests/a.test.js', CWD), 'tests/a.test.js');
  assert.equal(relativize('D:\\elsewhere\\x.js', CWD), 'D:/elsewhere/x.js');
  // The run directory itself (a search or a command run from the root) is the repository root.
  assert.equal(relativize(CWD, CWD), '.');
  assert.equal(relativize(`${CWD}\\`, CWD), '.');
});

test('a shell command names the repository paths it touches', () => {
  assert.deepEqual(bashPaths('node --test tests/mcp/tools.test.js && cat package.json', CWD), ['tests/mcp/tools.test.js', 'package.json']);
  assert.deepEqual(bashPaths('git diff --stat https://x.io/a/b FOO=bar', CWD), []);
  assert.deepEqual(bashPaths(`npx eslint "${CWD}\\src\\cli.js"`, CWD), ['src/cli.js']);
});

test('each tool becomes a normalized event, and unrelated tools none', () => {
  assert.deepEqual(toolEvent('Read', { file_path: `${CWD}\\src\\a.js` }, CWD), { kind: 'read', paths: ['src/a.js'] });
  assert.deepEqual(toolEvent('Edit', { file_path: `${CWD}\\src\\a.js`, old_string: 'x', new_string: 'y()' }, CWD), { kind: 'edit', paths: ['src/a.js'], text: 'y()' });
  assert.deepEqual(toolEvent('MultiEdit', { file_path: 'src/a.js', edits: [{ new_string: 'a' }, { new_string: 'b' }] }, CWD), { kind: 'edit', paths: ['src/a.js'], text: 'a\nb' });
  assert.deepEqual(toolEvent('Write', { file_path: 'src/b.js', content: 'z' }, CWD), { kind: 'write', paths: ['src/b.js'], text: 'z' });
  assert.deepEqual(toolEvent('Bash', { command: 'node --test tests/a.test.js' }, CWD), { kind: 'run', paths: ['tests/a.test.js'], text: 'node --test tests/a.test.js' });
  assert.deepEqual(toolEvent('Grep', { pattern: 'loadConfig', path: `${CWD}\\src` }, CWD), { kind: 'search', paths: ['src'], text: 'loadConfig' });
  assert.deepEqual(toolEvent('Glob', { pattern: '**/*.test.js' }, CWD), { kind: 'search', paths: [], text: '**/*.test.js' });
  assert.equal(toolEvent('TodoWrite', { todos: [] }, CWD), null);
});

test('a stream yields its tool calls in order, relative to the run directory', () => {
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init', cwd: CWD }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', name: 'Read', input: { file_path: `${CWD}\\src\\a.js` } }] } }),
    'not json',
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: `${CWD}\\src\\a.js`, new_string: 'b' } }] } }),
  ].join('\n');
  assert.deepEqual(streamEvents(stream), [{ kind: 'read', paths: ['src/a.js'] }, { kind: 'edit', paths: ['src/a.js'], text: 'b' }]);
});

test('a diff yields the lines each file gained, leaving out the DD store', () => {
  const diff = [
    'diff --git a/package.json b/package.json', '--- a/package.json', '+++ b/package.json', '@@ -1 +1,2 @@', ' {', '+  "a": 1',
    'diff --git a/.dd/memories/x.json b/.dd/memories/x.json', '+++ b/.dd/memories/x.json', '+{}',
    'diff --git a/tests/n.test.js b/tests/n.test.js', 'new file mode 100644', '+++ b/tests/n.test.js', '+one', '+two',
  ].join('\n');
  assert.deepEqual(addedByFile(diff), { 'package.json': '  "a": 1\n', 'tests/n.test.js': 'one\ntwo\n' });
});
