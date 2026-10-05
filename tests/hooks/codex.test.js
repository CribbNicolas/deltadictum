import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planCodexInstall, applyCodexInstall } from '../../scripts/install-codex.mjs';
import { createMemoryStore } from '../../src/store/create-store.js';
import { buildPreToolContext } from '../../src/hooks/pre-tool.js';
import { buildSessionStartContext } from '../../src/hooks/session-start.js';
import { startUiServer } from '../../src/ui/server.js';
import { registerResident, useTempRegistry } from '../helpers/resident.js';
import { PROVENANCE } from '../helpers/atom.js';

// Hook processes spawned here must not start a resident DD process (src/resident.js).
process.env.DD_RESIDENT = '0';
// Nor reach the machine's own resident through its registry.
await useTempRegistry();
// No resident here: these tests exercise the hooks in the explicit lexical mode.
process.env.DD_RETRIEVAL = 'lexical';

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
  // config, hooks, AGENTS.md, .dd/.gitignore and the eight dd-* command skills.
  assert.equal(plan.operations.length, 12);
  await applyCodexInstall(plan);
  const config = await readFile(join(root, '.codex/config.toml'), 'utf8');
  assert.match(config, /^model_reasoning_effort = "high"/);
  assert.match(config, /\[mcp_servers.dd.env\]/);
  // The installer writes the real path; a Windows runner's TEMP is an 8.3 short name (RUNNER~1).
  assert.ok(config.includes((await realpath(root)).replaceAll('\\', '/')));
  const hooks = JSON.parse(await readFile(join(root, '.codex/hooks.json'), 'utf8'));
  assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'existing-hook');
  assert.equal(hooks.hooks.Stop.length, 2);
  assert.match(hooks.hooks.PreToolUse[0].hooks[0].commandWindows, /^& '/);
  assert.match(await readFile(join(root, 'AGENTS.md'), 'utf8'), /^# Existing project guidance/);
  assert.equal((await planCodexInstall(root)).operations.length, 0);
});

test('Codex upgrades refresh owned hook settings and preserve other handlers', async () => {
  const root = await fixture();
  await applyCodexInstall(await planCodexInstall(root));
  // Plans name the real path: macOS tmpdir is a symlink, a Windows runner's TEMP an 8.3 short name.
  const path = join(await realpath(root), '.codex/hooks.json');
  const hooks = JSON.parse(await readFile(path, 'utf8'));
  const custom ={ type: 'command', command: 'custom-start', additionalContextLimit: 123 };
  hooks.hooks.SessionStart[0].matcher = 'startup|resume';
  hooks.hooks.SessionStart[0].hooks[0].additionalContextLimit = 800;
  hooks.hooks.SessionStart[0].hooks[0].timeout = 30;
  hooks.hooks.SessionStart[0].hooks.push(custom);
  hooks.hooks.PostToolUse[0].hooks[0].async = false;
  await writeFile(path, JSON.stringify(hooks));
  const plan = await planCodexInstall(root);
  assert.ok(plan.operations.some(op => op.path === path));
  await applyCodexInstall(plan);
  const updated = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(updated.hooks.SessionStart.length, 1);
  assert.equal(updated.hooks.SessionStart[0].matcher, 'startup|resume');
  assert.equal(updated.hooks.SessionStart[0].hooks.length, 2);
  assert.equal(updated.hooks.SessionStart[0].hooks[0].additionalContextLimit, 24000);
  assert.equal(updated.hooks.SessionStart[0].hooks[0].timeout, 10);
  assert.deepEqual(updated.hooks.SessionStart[0].hooks[1], custom);
  assert.equal(updated.hooks.PostToolUse[0].hooks[0].async, true);
  assert.equal((await planCodexInstall(root)).operations.length, 0);
});

test('Codex reinstalls from a moved DD replace its hooks instead of adding a second copy', async () => {
  const root = await fixture();
  await applyCodexInstall(await planCodexInstall(root));
  const path = join(root, '.codex/hooks.json');
  const hooks = JSON.parse(await readFile(path, 'utf8'));
  const current = hooks.hooks.PreToolUse[0].hooks[0];
  // As written by a source checkout under another Node, then installed again from there.
  const moved = handler => ({ ...handler,
    command: `'/old/node' '/old/checkout/src/hooks/run.js' ${handler.command.split("src/hooks/run.js' ")[1]}`,
    commandWindows: `& '/old/node' '/old/checkout/src/hooks/run.js' ${handler.commandWindows.split("src/hooks/run.js' ")[1]}` });
  for (const groups of Object.values(hooks.hooks)) for (const group of groups) group.hooks = group.hooks.map(moved);
  hooks.hooks.PreToolUse[0].hooks.push({ type: 'command', command: 'custom-pre-tool' });
  hooks.hooks.PreToolUse.push({ matcher: '*', hooks: [moved(current)] });
  await writeFile(path, JSON.stringify(hooks));
  await applyCodexInstall(await planCodexInstall(root));
  const updated = JSON.parse(await readFile(path, 'utf8'));
  for (const [event, groups] of Object.entries(updated.hooks)) {
    const dd = groups.flatMap(group => group.hooks).filter(h => h.command.includes('src/hooks/run.js'));
    assert.equal(dd.length, 1, event);
    assert.ok(!dd[0].command.includes('/old/'), event);
  }
  assert.equal(updated.hooks.PreToolUse.length, 1);
  assert.deepEqual(updated.hooks.PreToolUse[0].hooks.map(h => h.command), [current.command, 'custom-pre-tool']);
  assert.equal((await planCodexInstall(root)).operations.length, 0);
});

test('Codex upgrades preserve per-tool preferences in the DD managed block', async () => {
  const root = await fixture();
  await applyCodexInstall(await planCodexInstall(root));
  const path = join(await realpath(root), '.codex/config.toml');
  const preferences = '[mcp_servers.dd.tools.get]\napproval_mode = "approve"\noutput_token_limit = 2048\n\n[mcp_servers.dd.tools."propose"]\napproval_mode = "prompt"';
  const config = await readFile(path, 'utf8');
  await writeFile(path, config.replace('# END DD MANAGED CONFIG', `${preferences}\n# END DD MANAGED CONFIG`)
    .replace('startup_timeout_sec = 30', 'startup_timeout_sec = 99'));
  const plan = await planCodexInstall(root);
  assert.ok(plan.operations.some(op => op.path === path));
  await applyCodexInstall(plan);
  const updated = await readFile(path, 'utf8');
  assert.ok(updated.includes(preferences));
  assert.match(updated, /startup_timeout_sec = 30/);
  assert.equal((updated.match(/\[mcp_servers\.dd\.tools\.get\]/g) ?? []).length, 1);
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
  assert.match(stop.reason, /Available recorded evidence/);
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
  await registerResident(t, ui);
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
    ...PROVENANCE, lifecycle_state: 'active', authority: 'validated', confidence: 0.85, valid_from: '2026-01-01T00:00:00Z',
    applies_to: { files: ['domain/**'] }, retrieval_forms: { micro: 'Keep domain independent of Godot.' } });
  const payload = { session_id: 'codex', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: domain/Inventory.cs\n@@\n-old\n+new\n*** End Patch' } };
  assert.match((await buildPreToolContext(payload, { store, projectId: 'demo' })).hookSpecificOutput.additionalContext, /Keep domain independent/);
  assert.equal((await buildPreToolContext(payload, { store, projectId: 'demo' })).hookSpecificOutput, undefined);
  await buildSessionStartContext({ store, projectId: 'demo', sessionId: 'codex', source: 'compact' });
  assert.ok((await buildPreToolContext(payload, { store, projectId: 'demo' })).hookSpecificOutput);
});
