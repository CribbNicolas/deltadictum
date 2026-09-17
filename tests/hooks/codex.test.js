import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planCodexInstall, applyCodexInstall } from '../../scripts/install-codex.mjs';
import { createMemoryStore } from '../../src/store/create-store.js';
import { buildPreToolContext } from '../../src/hooks/pre-tool.js';
import { buildSessionStartContext } from '../../src/hooks/session-start.js';
import { startUiServer } from '../../src/ui/server.js';
import { writeUiUrl } from '../../src/hooks/banner.js';

async function fixture() {
  const root = join(await mkdtemp(join(tmpdir(), 'dd-codex-')), 'Project with spaces');
  await mkdir(root);
  await writeFile(join(root, 'project.godot'), '[application]\nconfig/name="Fixture"\n');
  return root;
}
function hook(project, command, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url)), command,
      '--codex', '--data', join(project, '.dd/local')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(`hook_failed:${code}`)) : resolve(output.trim() ? JSON.parse(output) : {}));
    child.stdin.end(JSON.stringify({ cwd: project, session_id: 'codex-fixture', ...payload }));
  });
}

test('Codex project installation preserves unrelated configuration and is idempotent', async () => {
  const root = await fixture();
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/config.toml'), 'model_reasoning_effort = "high"\n');
  await writeFile(join(root, 'AGENTS.md'), '# Existing project guidance\nKeep domain tests independent.\n');
  await writeFile(join(root, '.codex/hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-hook' }] }] } }));
  const plan = await planCodexInstall(root);
  assert.equal(plan.operations.length, 7);
  await applyCodexInstall(plan);
  const config = await readFile(join(root, '.codex/config.toml'), 'utf8');
  assert.match(config, /^model_reasoning_effort = "high"/);
  assert.match(config, /\[mcp_servers.dd.env\]/);
  assert.ok(config.includes(root.replaceAll('\\', '/')));
  const hooks = JSON.parse(await readFile(join(root, '.codex/hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'existing-hook');
  assert.equal(hooks.hooks.Stop.length, 2);
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].commandWindows, /^& '/);
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /^# Existing project guidance/);
  assert.equal((await planCodexInstall(root)).operations.length, 0);
});

test('Codex installer refuses to overwrite an unrelated DD server', async () => {
  const root = await fixture();
  await mkdir(join(root, '.codex'));
  await writeFile(join(root, '.codex/config.toml'), '[mcp_servers.dd]\ncommand="existing"\n');
  await assert.rejects(() => planCodexInstall(root), /existing_dd_server_requires_review/);
});

test('Codex hook capture can recur in later turns, without loops or repeated evidence, through both store paths', async t => {
  const root = await fixture();
  await applyCodexInstall(await planCodexInstall(root));
  const start = await hook(root, 'session-start', { source: 'startup' });
  assert.equal(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(start.hookSpecificOutput.additionalContext, /codex-fixture/);
  assert.deepEqual(await hook(root, 'stop', {}), {});
  const skipped = await hook(root, 'pre-tool', { tool_name: 'mcp__dd__retrieve' });
  assert.deepEqual(skipped, {});
  await hook(root, 'observe', { tool_name: 'Bash', tool_input: { command: 'dotnet test' }, tool_response: { exit_code: 0, output: 'Passed.' } });
  const stop = await hook(root, 'stop', {});
  assert.equal(stop.decision, 'block');
  assert.match(stop.reason, /propose/);
  assert.match(stop.reason, /Available host evidence/);
  assert.deepEqual(await hook(root, 'stop', { stop_hook_active: true }), {});
  assert.deepEqual(await hook(root, 'stop', {}), {});
  await hook(root, 'prompt', { prompt: 'Continue the next part of the task.' });
  assert.deepEqual(await hook(root, 'stop', {}), {});
  await hook(root, 'observe', { tool_name: 'Bash', tool_input: { command: 'dotnet test' }, tool_response: { exit_code: 1, output: 'New failure.' } });
  assert.equal((await hook(root, 'stop', {})).decision, 'block');
  await hook(root, 'observe', { tool_name: 'Bash', tool_input: { command: 'dotnet test' }, tool_response: { exit_code: 0, output: 'Validation during capture.' } });
  assert.deepEqual(await hook(root, 'stop', { stop_hook_active: true }), {});
  assert.deepEqual(await hook(root, 'stop', {}), {});

  const ddDir = join(root, '.dd');
  const store = await createMemoryStore({ ddDir, dataDir: join(ddDir, 'local') });
  const projectId = (await store.loadConfig()).project_id;
  const ui = await startUiServer({ store, projectId, port: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await writeUiUrl(ddDir, ui);
  await hook(root, 'prompt', { prompt: 'Start another task in this long conversation.' });
  assert.equal(store.index.db.prepare('SELECT stopped FROM capture_prompts WHERE project_id=? AND session_id=?').get(projectId, 'codex-fixture').stopped, 0);
  await hook(root, 'observe', { tool_name: 'Bash', tool_input: { command: 'dotnet test' }, tool_response: { exit_code: 0, output: 'A later task passed.' } });
  assert.equal((await hook(root, 'stop', {})).decision, 'block');
  assert.deepEqual(await hook(root, 'stop', {}), {});
});

test('Codex patch paths activate file scopes and compaction makes advice available again', async t => {
  const root = await fixture();
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, '.dd/local') });
  t.after(() => store.close());
  await store.putAtom({ id: 'fixture', project_id: 'demo', topic_key: 'domain/tests/isolation', memory_type: 'lesson', scope: 'project',
    title: 'Keep domain pure', trigger: 'when editing domain tests', behavior_delta: 'Keep domain independent of Godot.', what: 'Keep domain independent of Godot.', why: 'Headless testing.',
    lifecycle_state: 'active', authority: 'validated', confidence: 0.85, valid_from: '2026-01-01T00:00:00Z',
    applies_to: { files: ['domain/**'] }, retrieval_forms: { micro: 'Keep domain independent of Godot.' } });
  const payload = { session_id: 'codex', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: domain/Inventory.cs\n@@\n-old\n+new\n*** End Patch' } };
  assert.match((await buildPreToolContext(payload, { store, projectId: 'demo' })).hookSpecificOutput.additionalContext, /Keep domain independent/);
  assert.equal((await buildPreToolContext(payload, { store, projectId: 'demo' })).hookSpecificOutput, undefined);
  await buildSessionStartContext({ store, projectId: 'demo', sessionId: 'codex', source: 'compact' });
  assert.ok((await buildPreToolContext(payload, { store, projectId: 'demo' })).hookSpecificOutput);
});
