import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cursorCommand, planCursorInstall } from '../../scripts/install-cursor.mjs';
import { applyCodexInstall } from '../../scripts/install-codex.mjs';
import { compileProject } from '../../src/engine/compile.js';
import { cursorPayload } from '../../src/hooks/cursor.cjs';
import { createMemoryFiles } from '../../src/memory/store.js';

// Cursor payloads in the shape its CLI's source builds them (agent-cli-package 2026.10.19): conversation_id
// and workspace_roots on every event, tool_input per tool, tool_output a JSON string. Not yet recorded from a
// real session.
const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
const memory = (id, title, triggers, body = `${title}, always.`) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title, body,
  not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
});

async function project(t, memories = [memory('m1', 'Close stores', [{ on: ['read', 'edit'], paths: ['src/a.js'] }])]) {
  const root = mkdtempSync(join(tmpdir(), 'dd-cursor-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await createMemoryFiles(join(root, '.dd')).commit({ put: memories });
  await compileProject(root);
  return root;
}
const hook = (command, payload) => spawnSync(process.execPath, [RUN, command, '--cursor'], { input: JSON.stringify(payload), encoding: 'utf8' });
const answer = result => JSON.parse(result.stdout);
const base = (root, event, more) => ({ conversation_id: 'c1', generation_id: 'g1', model: 'm', hook_event_name: event,
  cursor_version: '2026.10.19', workspace_roots: [root], ...more });

test('a Read delivers the memories of its file before the call, once per conversation', async t => {
  const root = await project(t);
  const read = hook('pre-tool', base(root, 'preToolUse', { tool_name: 'Read', tool_input: { file_path: join(root, 'src', 'a.js') }, tool_use_id: 'u1', cwd: root }));
  assert.equal(read.status, 0);
  const first = answer(read);
  assert.match(first.additional_context, /^DD - project knowledge \(src\/a\.js\):\n\[TRAP\] Close stores/);
  // DD never answers a permission: the person and Cursor keep deciding what runs.
  assert.equal(first.permission, undefined);
  assert.deepEqual(answer(hook('pre-tool', base(root, 'preToolUse', { tool_name: 'Read', tool_input: { file_path: join(root, 'src', 'a.js') }, cwd: root }))), {});
  const other = hook('pre-tool', base(root, 'preToolUse', { conversation_id: 'c2', tool_name: 'Read', tool_input: { file_path: 'src/a.js' }, cwd: root }));
  assert.match(answer(other).additional_context, /Close stores/);
});

test('a Write to an existing file is an edit; to a new file, a write', async t => {
  const root = await project(t, [memory('m1', 'Edit with care', [{ on: ['edit'], paths: ['src/**'] }])]);
  const create = hook('pre-tool', base(root, 'preToolUse', { tool_name: 'Write', tool_input: { file_path: join(root, 'src', 'new.js'), content: 'x' }, cwd: root }));
  assert.deepEqual(answer(create), {});
  const edit = hook('pre-tool', base(root, 'preToolUse', { tool_name: 'Write', tool_input: { file_path: join(root, 'src', 'a.js'), content: 'export const a = 2;\n' }, cwd: root }));
  assert.match(answer(edit).additional_context, /Edit with care/);
});

test('a prompt delivers its memories through beforeSubmitPrompt', async t => {
  const root = await project(t, [memory('m2', 'Adopt old data directories', [{ on: ['prompt'], keywords: ['data directory'] }])]);
  const prompt = hook('prompt', base(root, 'beforeSubmitPrompt', { prompt: 'Move the data directory to /var', attachments: [] }));
  assert.match(answer(prompt).additional_context, /Adopt old data directories/);
});

test('a delivery stays within the 10,000 characters Cursor accepts, whatever delivery_limit says', async t => {
  const long = n => memory(`m${n}`, `Rule ${n}`, [{ on: ['read'], paths: ['src/a.js'] }], `${'Keep this in mind. '.repeat(70)}${n}`);
  const root = await project(t, Array.from({ length: 12 }, (_, n) => long(n)));
  writeFileSync(join(root, '.dd', 'config.json'), JSON.stringify({ delivery_limit: 50000 }));
  await compileProject(root);
  const read = answer(hook('pre-tool', base(root, 'preToolUse', { tool_name: 'Read', tool_input: { file_path: 'src/a.js' }, cwd: root })));
  assert.ok(read.additional_context.length <= 10000, `${read.additional_context.length} characters`);
  assert.match(read.additional_context, /Rule 0/);
});

test('every answer is valid JSON, even for a payload DD cannot read', async t => {
  const root = await project(t);
  for (const command of ['session-start', 'observe-prompt', 'observe', 'inbox', 'stop']) {
    const result = hook(command, base(root, 'x', { cwd: root }));
    assert.equal(result.status, 0, command);
    assert.deepEqual(answer(result), {}, command);
  }
  const garbage = spawnSync(process.execPath, [RUN, 'pre-tool', '--cursor'], { input: 'not json', encoding: 'utf8' });
  assert.deepEqual([garbage.status, garbage.stdout], [0, '{}']);
});

test('a failure, then a fix: Stop answers with a followup_message', async t => {
  const root = await project(t);
  const shell = (code, stdout) => hook('observe', base(root, 'postToolUse', { tool_name: 'Shell', tool_input: { command: 'npm test' }, cwd: root,
    tool_output: JSON.stringify({ exitCode: code, stdout }), duration: 10 }));
  shell(1, 'FAIL src/a.js: store left open');
  hook('observe', base(root, 'postToolUse', { tool_name: 'Write', tool_input: { file_path: join(root, 'src', 'a.js'), content: 'export const a = 2;\n' }, cwd: root, tool_output: '{}' }));
  shell(0, 'pass');
  const stop = answer(hook('stop', base(root, 'stop', { status: 'completed', loop_count: 0 })));
  assert.match(stop.followup_message, /DD/);
  assert.equal(stop.additional_context, undefined);
  // A turn Cursor already continued, or one that did not complete, is not asked again.
  assert.deepEqual(answer(hook('stop', base(root, 'stop', { status: 'completed', loop_count: 1 }))), {});
});

test('a memory saved with Write into the inbox is ingested and answered', async t => {
  const root = await project(t);
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  const proposal = { topic: 'config/a-constant', kind: 'fact', title: 'a is one on purpose', body: 'Keep `a` in src/a.js at 1: the importer reads it as a version.',
    not_derivable: 'The importer lives in another repository.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [{ type: 'file', path: 'src/a.js' }] };
  const file = join(root, '.dd', 'inbox', 'a.json');
  writeFileSync(file, JSON.stringify(proposal));
  const result = answer(hook('inbox', base(root, 'postToolUse', { tool_name: 'Write', tool_input: { file_path: file, content: JSON.stringify(proposal) }, cwd: root, tool_output: '{}' })));
  assert.match(result.additional_context, /config\/a-constant: stored/);
  assert.equal(readdirSync(join(root, '.dd', 'memories')).filter(name => name !== 'manifest.json').length, 2);
});

test('the payload maps to the shape DD reads', () => {
  const failed = cursorPayload({ conversation_id: 'c', workspace_roots: ['/r'], tool_name: 'Shell', tool_input: { command: 'npm test', working_directory: '/r/sub' },
    error_message: 'boom', failure_type: 'error', is_interrupt: false }, 'observe');
  assert.deepEqual([failed.session_id, failed.cwd, failed.tool_name, failed.tool_input.command, failed.is_error], ['c', '/r/sub', 'Bash', 'npm test', true]);
  assert.equal(cursorPayload({ tool_name: 'Shell', tool_input: { command: 'x' }, error_message: 'no', failure_type: 'permission_denied' }, 'observe').is_error, undefined);
  const ran = cursorPayload({ tool_name: 'Shell', tool_input: { command: 'ls' }, tool_output: '{"exitCode":0,"stdout":"a"}' }, 'observe');
  assert.deepEqual(ran.tool_response, { exitCode: 0, stdout: 'a' });
  assert.deepEqual(cursorPayload({ tool_name: 'Grep', tool_input: { pattern: 'p', file_path: 'src' } }, 'pre-tool').tool_input, { pattern: 'p', path: 'src' });
  assert.equal(cursorPayload({ tool_name: 'Delete', tool_input: { file_path: 'a.js' } }, 'pre-tool').tool_name, 'Edit');
  assert.equal(cursorPayload({ conversation_id: 'c' }, 'stop').stop_hook_active, false);
});

test('the Cursor installer writes its hooks, keeps the project\'s own, and runs again cleanly', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-cursor-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.cursor'));
  const mine = { command: '.cursor/hooks/format.sh' };
  writeFileSync(join(root, '.cursor', 'hooks.json'), JSON.stringify({ version: 1, hooks: { afterFileEdit: [mine], stop: [mine] } }));
  const plan = await planCursorInstall(root, { platform: 'linux' });
  await applyCodexInstall(plan);
  const hooks = JSON.parse(readFileSync(join(root, '.cursor', 'hooks.json'), 'utf8'));
  assert.equal(hooks.version, 1);
  assert.deepEqual(hooks.hooks.afterFileEdit, [mine]);
  assert.deepEqual(hooks.hooks.stop[0], mine);
  const commands = Object.values(hooks.hooks).flat().map(entry => entry.command).filter(command => command.includes('run.cjs'));
  assert.equal(commands.length, 8);
  for (const command of commands) assert.match(command, /'--cursor'$/);
  // Capture runs before delivery where an event runs both: Cursor keeps the last additional_context.
  assert.match(hooks.hooks.beforeSubmitPrompt.at(-1).command, /'prompt'/);
  assert.match(hooks.hooks.postToolUse.at(-1).command, /'inbox'/);
  assert.ok(!new RegExp(hooks.hooks.preToolUse[0].matcher).test('ReadLints'));
  assert.ok(new RegExp(hooks.hooks.preToolUse[0].matcher).test('Shell'));
  assert.ok(readFileSync(join(root, '.agents', 'skills', 'dd-save', 'SKILL.md'), 'utf8').includes('name: dd-save'));
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /DD project knowledge/);
  assert.deepEqual((await planCursorInstall(root, { platform: 'linux' })).operations, []);
});

test('on Windows the hook commands are PowerShell, as Cursor runs them', () => {
  const command = cursorCommand('pre-tool', { node: 'C:\\Program Files\\nodejs\\node.exe', root: 'C:\\dd', platform: 'win32' });
  assert.equal(command, "& 'C:/Program Files/nodejs/node.exe' 'C:/dd/hooks/run.cjs' 'pre-tool' '--cursor'");
});
