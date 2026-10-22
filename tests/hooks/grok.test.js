import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../../src/engine/compile.js';
import { grokPayload } from '../../src/hooks/grok.cjs';
import { createMemoryFiles } from '../../src/memory/store.js';

// Grok Build payloads in the shape its hook guide documents (grok 1.0.41, 2026-10-22): camelCase keys
// and Grok's own tool names. Not yet recorded from a real session.
const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
const PLUGIN = JSON.parse(readFileSync(new URL('../../.grok-plugin/plugin.json', import.meta.url), 'utf8'));
const memory = (id, title, triggers) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title, body: `${title}, always.`,
  not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
});

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-grok-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory('m1', 'Close stores', [{ on: ['read', 'edit'], paths: ['src/a.js'] }])] });
  await compileProject(root);
  return root;
}
const hook = (command, payload) => spawnSync(process.execPath, [RUN, command, '--grok'], { input: JSON.stringify(payload), encoding: 'utf8' });
const context = result => (result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : '');
const envelope = (root, event, more) => ({ hookEventName: event.replace(/[A-Z]/g, c => `_${c.toLowerCase()}`).slice(1), hook_event_name: event,
  sessionId: 'g1', cwd: root, workspaceRoot: root, permissionMode: 'default', timestamp: '2026-10-22T00:00:00Z', ...more });

test('a read_file or a search_replace delivers the memories of its file, once per session', async t => {
  const root = await project(t);
  const read = hook('pre-tool', envelope(root, 'PreToolUse', { toolName: 'read_file', toolInput: { path: 'src/a.js' }, toolUseId: 'u1' }));
  assert.equal(read.status, 0);
  assert.match(context(read), /^DD - project knowledge \(src\/a\.js\):\n\[TRAP\] Close stores/);
  const again = hook('pre-tool', envelope(root, 'PreToolUse', { toolName: 'search_replace', toolInput: { file_path: 'src/a.js', old_string: '1', new_string: '2' } }));
  assert.equal(again.stdout, '');
  const other = hook('pre-tool', envelope(root, 'PreToolUse', { sessionId: 'g2', toolName: 'search_replace', toolInput: { filePath: 'src/a.js', oldString: '1', newString: '2' } }));
  assert.match(context(other), /Close stores/);
});

test('a memory saved with search_replace into the inbox is ingested and answered', async t => {
  const root = await project(t);
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  const proposal = { topic: 'config/a-constant', kind: 'fact', title: 'a is one on purpose', body: 'Keep `a` in src/a.js at 1: the importer reads it as a version.',
    not_derivable: 'The importer lives in another repository.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [{ type: 'file', path: 'src/a.js' }] };
  writeFileSync(join(root, '.dd', 'inbox', 'a.json'), JSON.stringify(proposal));
  const result = hook('inbox', envelope(root, 'PostToolUse', { toolName: 'search_replace',
    toolInput: { file_path: join(root, '.dd', 'inbox', 'a.json'), old_string: '', new_string: JSON.stringify(proposal) }, toolResult: { type: 'SearchReplace' } }));
  assert.match(context(result), /config\/a-constant: stored/);
  assert.equal(readdirSync(join(root, '.dd', 'memories')).filter(name => name !== 'manifest.json').length, 2);
});

test('the payload maps to the shape DD reads; the session-end Stop asks nothing', () => {
  const shell = grokPayload({ sessionId: 's', cwd: '/r', toolName: 'run_terminal_command', toolInput: { command: 'npm test' },
    toolResult: { type: 'Bash', command: 'npm test', exit_code: 1, output_for_prompt: '1 failed' } });
  assert.deepEqual([shell.session_id, shell.tool_name, shell.tool_input.command, shell.tool_response.exit_code, shell.tool_response.output],
    ['s', 'Bash', 'npm test', 1, '1 failed']);
  assert.equal(grokPayload({ sessionId: 's', toolName: 'search_replace', toolInput: { path: 'n.js', old_string: '', new_string: 'x' } }).tool_name, 'Write');
  assert.equal(grokPayload({ sessionId: 's', hook_event_name: 'Stop', reason: 'shutdown' }).stop_hook_active, true);
  assert.equal(grokPayload({ sessionId: 's', hook_event_name: 'Stop', reason: 'end_turn', stopHookActive: false }).stop_hook_active, false);
  const claude = { session_id: 's', tool_name: 'Read', tool_input: { file_path: 'a' } };
  assert.equal(grokPayload(claude), claude);
});

test('every hook of the Grok plugin runs with --grok and matches Grok\'s tool names', () => {
  const handlers = Object.values(PLUGIN.hooks).flat().flatMap(group => group.hooks.map(handler => ({ ...handler, matcher: group.matcher })));
  for (const handler of handlers) assert.match(handler.command, / --grok$/);
  for (const handler of handlers.filter(h => /pre-tool|observe$/.test(h.command) && h.matcher)) {
    for (const tool of ['read_file', 'search_replace', 'run_terminal_command']) assert.match(tool, new RegExp(`^(?:${handler.matcher})$`));
  }
  assert.ok(existsSync(fileURLToPath(new URL('../../skills/save/SKILL.md', import.meta.url))));
});
