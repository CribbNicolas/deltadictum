import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCodexInstall, planCodexInstall } from '../../scripts/install-codex.mjs';
import { compileProject } from '../../src/engine/compile.js';
import { shellKind } from '../../src/hooks/v2/codex.cjs';
import { createMemoryFiles } from '../../src/memory/store.js';

// Codex payloads as v1 recorded them from real sessions (2026-09): Claude Code's
// shape, with the shell tool as Bash and edits through apply_patch, whose patch
// text is tool_input.command.
const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
const memory = (id, title, triggers) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title, body: `${title}, always.`,
  not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
});

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-codex-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await createMemoryFiles(join(root, '.dd')).commit({ put: [
    memory('m1', 'Close stores', [{ on: ['read', 'edit'], paths: ['src/a.js'] }]),
  ] });
  await compileProject(root);
  return root;
}
const hook = (command, payload) => spawnSync(process.execPath, [RUN, command, '--codex'], { input: JSON.stringify(payload), encoding: 'utf8' });
const context = result => (result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : '');
const patch = file => `*** Begin Patch\n*** Update File: ${file}\n@@\n-export const a = 1;\n+export const a = 2;\n*** End Patch`;

test('an apply_patch delivers the memories of the files its headers name', async t => {
  const root = await project(t);
  const result = hook('pre-tool', { session_id: 'c1', cwd: root, tool_name: 'apply_patch', tool_input: { command: patch('src/a.js') } });
  assert.equal(result.status, 0);
  assert.match(context(result), /^DD - project knowledge \(src\/a\.js\):\n\[TRAP\] Close stores/);
});

test('a shell command that only reads a file is a read; one that writes is not', async t => {
  const root = await project(t);
  const reads = hook('pre-tool', { session_id: 'c2', cwd: root, tool_name: 'Bash', tool_input: { command: ['bash', '-lc', "sed -n '1,40p' src/a.js"] } });
  assert.match(context(reads), /Close stores/);
  const writes = hook('pre-tool', { session_id: 'c3', cwd: root, tool_name: 'Bash', tool_input: { command: "sed -i 's/1/2/' src/a.js" } });
  assert.equal(writes.stdout, '');
});

test('shell commands are read, search or run by every step they take', () => {
  assert.equal(shellKind('cat src/a.js'), 'read');
  assert.equal(shellKind('cd src && head -n 20 a.js | nl'), 'read');
  assert.equal(shellKind('rg -n "createStore" src 2>/dev/null'), 'search');
  assert.equal(shellKind('git grep -n store -- src'), 'search');
  assert.equal(shellKind('Get-Content src/a.js'), 'read');
  assert.equal(shellKind('npm test'), null);
  assert.equal(shellKind('cat a.js > b.js'), null);
  assert.equal(shellKind('cat a.js &> b.txt'), null);
  assert.equal(shellKind('cat a.js && npm test'), null);
  assert.equal(shellKind('cd src'), null);
});

test('a Stop with something to say blocks with the reason, as Codex expects', async t => {
  const root = await project(t);
  // A failure followed by a fix in the turn: the evidence that makes Stop ask for a memory.
  const run = (code, output) => hook('observe', { session_id: 'c4', cwd: root, tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { exit_code: code, output } });
  run(1, 'FAIL src/a.js: store left open');
  hook('observe', { session_id: 'c4', cwd: root, tool_name: 'apply_patch', tool_input: { command: patch('src/a.js') }, tool_response: { exit_code: 0, output: 'Done' } });
  run(0, 'pass');
  const stop = hook('stop', { session_id: 'c4', cwd: root, stop_hook_active: false });
  assert.equal(stop.status, 0);
  const output = JSON.parse(stop.stdout);
  assert.equal(output.decision, 'block');
  assert.match(output.reason, /DD/);
  assert.equal(output.hookSpecificOutput, undefined);
});

test('a proposal written through apply_patch into .dd/inbox is ingested', async t => {
  const root = await project(t);
  const proposal = { topic: 'testing/codex-inbox', kind: 'trap', title: 'The constant a in src/a.js is read at import time',
    body: 'Changing `a` in src/a.js needs a restart: callers copy it when the module loads, so a later edit is not seen.',
    not_derivable: 'Only a stale value in a long session shows it; no test covers it.',
    triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [{ type: 'file', path: 'src/a.js' }] };
  const file = '.dd/inbox/p1.json';
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  writeFileSync(join(root, file), JSON.stringify(proposal));
  const added = `*** Begin Patch\n*** Add File: ${file}\n+${JSON.stringify(proposal)}\n*** End Patch`;
  const result = hook('inbox', { session_id: 'c5', cwd: root, tool_name: 'apply_patch', tool_input: { command: added } });
  assert.match(context(result), /testing\/codex-inbox: stored/);
  assert.equal(existsSync(join(root, file)), false);
});

test('the Codex installer registers the v2 hooks and writes no MCP server', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-codex-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.codex'));
  writeFileSync(join(root, '.codex', 'config.toml'), 'model_reasoning_effort = "high"\n');
  await applyCodexInstall(await planCodexInstall(root));
  const hooks = JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf8')).hooks;
  const commands = Object.fromEntries(Object.entries(hooks).map(([event, groups]) => [event,
    groups.flatMap(group => group.hooks.map(handler => `${group.matcher ?? ''} ${handler.command.match(/run\.cjs' '([\w-]+)'/)[1]}`))]));
  assert.deepEqual(commands, {
    SessionStart: [' session-start'], UserPromptSubmit: [' prompt', ' observe-prompt'], PreToolUse: ['* pre-tool'],
    PostToolUse: ['* observe', 'apply_patch inbox'], Stop: [' stop'],
  });
  assert.ok(Object.values(hooks).flat().every(group => group.hooks.every(handler => !handler.command.includes('--data'))));
  const config = readFileSync(join(root, '.codex', 'config.toml'), 'utf8');
  assert.match(config, /^model_reasoning_effort = "high"/);
  assert.doesNotMatch(config, /mcp_servers/);
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  assert.doesNotMatch(agents, /MCP|orient|retrieve/);
  assert.match(agents, /dd-save/);
  // The install is the project's opt-in: DD records and asks from the first session.
  assert.equal(JSON.parse(readFileSync(join(root, '.dd', 'config.json'), 'utf8')).project_id, basename(root));
  assert.equal((await planCodexInstall(root)).operations.length, 0);
});

test('the Codex installer leaves an existing .dd/config.json alone', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-codex-config-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.dd'));
  writeFileSync(join(root, '.dd', 'config.json'), '{ "auto_accept": false }\n');
  await applyCodexInstall(await planCodexInstall(root));
  assert.equal(readFileSync(join(root, '.dd', 'config.json'), 'utf8'), '{ "auto_accept": false }\n');
});
