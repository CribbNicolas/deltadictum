import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// Claude Code reads a plugin's hooks from hooks/hooks.json at the plugin root and
// runs them from the user's project directory. A relative command (node run.cjs)
// fails there with MODULE_NOT_FOUND on every event: found 2026-09-23 by loading
// the plugin into a fresh project, after `claude plugin validate` had passed.
test('every plugin hook command is anchored at the plugin root and names a real file', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  const commands = Object.values(manifest.hooks).flat().flatMap(entry => entry.hooks.map(hook => hook.command));
  assert.ok(commands.length >= 3);
  for (const command of commands) {
    assert.match(command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/run\.cjs" [a-z-]+$/, command);
  }
  await access(join(ROOT, 'hooks', 'run.cjs'));
});

test('v2 listens at session start, at prompts and before the tools that carry project work', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'hooks', 'hooks.json'), 'utf8'));
  assert.deepEqual(Object.keys(manifest.hooks).sort(), ['PostToolUse', 'PostToolUseFailure', 'PreToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit']);
  assert.match(manifest.hooks.Stop[0].hooks[0].command, / stop$/);
  assert.ok(manifest.hooks.PostToolUse.some(group => group.matcher === 'Write|Edit|MultiEdit' && group.hooks.some(hook => / inbox$/.test(hook.command) && !hook.async)));
  const observe = event => manifest.hooks[event].flatMap(group => group.hooks).find(hook => / observe$/.test(hook.command));
  assert.equal(observe('PostToolUse').async, true);
  assert.equal(observe('PostToolUseFailure').async, true);
  assert.ok(manifest.hooks.UserPromptSubmit.flatMap(group => group.hooks).some(hook => / observe-prompt$/.test(hook.command) && hook.async === true));
  assert.equal(manifest.hooks.PreToolUse[0].matcher, 'Read|Edit|Write|MultiEdit|NotebookEdit|Bash|Grep|Glob');
  const command = event => manifest.hooks[event][0].hooks[0].command;
  assert.match(command('SessionStart'), / session-start$/);
  assert.match(command('UserPromptSubmit'), / prompt$/);
  assert.match(command('PreToolUse'), / pre-tool$/);
});

// Grok Build runs Claude Code's hooks (docs/integrations/grok-build.md): both
// Grok files register the events, matchers and commands hooks/hooks.json does,
// each with its own root. Found missing: inbox (so /dd:save was never ingested
// on Grok), observe-prompt and PostToolUseFailure.
test('the Grok manifests register every hook hooks.json does, with the same matchers and flags', async () => {
  const shape = manifest => Object.entries(manifest.hooks).flatMap(([event, groups]) => groups.flatMap(group => group.hooks.map(hook =>
    `${event} ${group.matcher ?? ''} ${/hooks\/run\.cjs"? ([a-z-]+)$/.exec(hook.command)?.[1]} async=${hook.async === true}`))).sort();
  const expected = shape(JSON.parse(await readFile(join(ROOT, 'hooks', 'hooks.json'), 'utf8')));
  for (const file of ['.grok-plugin/plugin.json', '.grok/hooks/dd.json']) {
    assert.deepEqual(shape(JSON.parse(await readFile(join(ROOT, file), 'utf8'))), expected, file);
  }
  const plugin = JSON.parse(await readFile(join(ROOT, '.grok-plugin', 'plugin.json'), 'utf8'));
  for (const hook of Object.values(plugin.hooks).flat().flatMap(group => group.hooks)) {
    assert.match(hook.command, /^node "\$\{GROK_PLUGIN_ROOT\}\/hooks\/run\.cjs" [a-z-]+$/, hook.command);
  }
});

test('DD ships no MCP server and no MCP dependency', async () => {
  const plugin = JSON.parse(await readFile(join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.mcpServers, undefined);
  const grok = JSON.parse(await readFile(join(ROOT, '.grok-plugin', 'plugin.json'), 'utf8'));
  assert.equal(grok.mcpServers, undefined);
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.['@modelcontextprotocol/sdk'], undefined);
  assert.equal(pkg.dependencies?.zod, undefined);
  assert.equal(pkg.scripts.mcp, undefined);
  await assert.rejects(access(join(ROOT, '.mcp.json')));
  await assert.rejects(access(join(ROOT, 'src', 'mcp')));
});
