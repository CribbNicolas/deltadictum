import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFootprint, correctionEntry, footprintPath, readFootprint, toolEntry } from '../../src/capture/footprint.js';

const scratch = t => { const root = mkdtempSync(join(tmpdir(), 'dd-fp-')); t.after(() => rmSync(root, { recursive: true, force: true })); return root; };

test('a write records its path and identifiers, never its content', t => {
  const root = scratch(t);
  const entry = toolEntry({ tool_name: 'Write', tool_input: { file_path: join(root, 'src', 'a.js'), content: 'const apiKey = "sk-abcdefghijklmnop1234";\nexport function parseConfig() {}' } }, { root });
  assert.deepEqual(entry.paths, ['src/a.js']);
  assert.equal(entry.kind, 'write');
  assert.ok(entry.identifiers.includes('parseConfig'));
  assert.doesNotMatch(JSON.stringify(entry), /sk-abcdefghijklmnop1234|export function/);
});

test('a failing command records the redacted command and output, and the output identifiers', t => {
  const root = scratch(t);
  const entry = toolEntry({ hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'TOKEN=ghp_abcdefghijklmnopqrstuv npm test' },
    error: 'TypeError: parseConfig is not a function at src/config.js:3' }, { root, claudeCode: true });
  assert.equal(entry.outcome, 'failure');
  assert.equal(entry.kind, 'run');
  assert.doesNotMatch(entry.command, /ghp_/);
  assert.match(entry.preview, /parseConfig is not a function/);
  assert.ok(entry.output_identifiers.includes('parseConfig'));
});

test('a passing validation is recorded; an ordinary success has no outcome', t => {
  const root = scratch(t);
  const passed = toolEntry({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { stdout: 'ok 3 tests', stderr: '', interrupted: false } }, { root, claudeCode: true });
  assert.equal(passed.outcome, 'validation');
  const listed = toolEntry({ hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls src' },
    tool_response: { stdout: 'a.js', stderr: '', interrupted: false } }, { root, claudeCode: true });
  assert.equal(listed.outcome, undefined);
  assert.equal(toolEntry({ tool_name: 'TodoWrite', tool_input: {} }, { root }), null);
});

test('a user correction is recorded; an ordinary prompt is not', () => {
  assert.match(correctionEntry({ prompt: 'No, that is wrong: use the store in t.after instead' }).preview, /User correction/);
  assert.equal(correctionEntry({ prompt: 'Add a test for the parser' }), null);
});

// Post-tool hooks are async: a slower one can append after the next tool's hook.
// Entries carry when their hook started, and read back in that order.
test('entries read back in the order their hooks started, not the order they were appended', t => {
  const root = scratch(t);
  const path = footprintPath(root, 's1');
  appendFootprint(path, { t: 'tool', id: 'edit', at: '2026-10-12T06:21:53.752Z' });
  appendFootprint(path, { t: 'tool', id: 'fail', at: '2026-10-12T06:21:51.674Z' });
  appendFootprint(path, { t: 'asked', id: 'asked', at: '2026-10-12T06:21:59.783Z' });
  assert.deepEqual(readFootprint(path).map(e => e.id), ['fail', 'edit', 'asked']);
  const started = new Date(performance.timeOrigin).toISOString();
  assert.equal(toolEntry({ tool_name: 'Read', tool_input: { file_path: join(root, 'a.js') } }, { root }).at, started);
});

test('the footprint lives beside the ledger, in its own file, and reads back in order', t => {
  const root = scratch(t);
  const path = footprintPath(root, 's/1');
  assert.match(path.replaceAll('\\', '/'), /\.dd\/local\/sessions\/s-1\.footprint\.jsonl$/);
  assert.equal(footprintPath(root, ''), null);
  appendFootprint(path, { t: 'tool', id: 'e1' });
  appendFootprint(path, { t: 'correction', id: 'e2' });
  assert.deepEqual(readFootprint(path).map(e => e.id), ['e1', 'e2']);
  assert.deepEqual(readFootprint(join(root, 'missing.jsonl')), []);
});
