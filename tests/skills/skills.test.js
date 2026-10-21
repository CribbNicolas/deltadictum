import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planCodexInstall } from '../../scripts/install-codex.mjs';

export const COMMANDS = ['save', 'recall', 'review'];
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

// Claude Code shows plugin skills as /<plugin>:<skill>, so the plugin is named dd.
test('every command skill exists, is named after its directory and is written in English', async () => {
  for (const name of COMMANDS) {
    const text = (await read(`skills/${name}/SKILL.md`)).replace(/\r\n/g, '\n');
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`), name);
    assert.doesNotMatch(text, /[áéíóúñ¿¡]/, `${name} must be English`);
  }
  assert.equal(JSON.parse(await read('.claude-plugin/plugin.json')).name, 'dd');
  assert.equal(JSON.parse(await read('.claude-plugin/marketplace.json')).plugins[0].name, 'dd');
});

// Claude Code lists every skill in skills/, so all of them count, not only COMMANDS.
test('the plugin costs at most 150 tokens of fixed context: three short skill descriptions', async () => {
  const shipped = (await readdir(new URL('../../skills/', import.meta.url), { withFileTypes: true }))
    .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(shipped, [...COMMANDS].sort());
  let characters = 0;
  for (const name of shipped) {
    const text = (await read(`skills/${name}/SKILL.md`)).replace(/\r\n/g, '\n');
    const description = /^---\nname: .+\ndescription: (.+)\n---\n/.exec(text)[1];
    characters += name.length + description.length;
  }
  assert.ok(Math.ceil(characters / 4) <= 150, `${Math.ceil(characters / 4)} tokens`);
});

// Codex has no plugin namespace: the skills are installed prefixed, so a project
// skill called review or init is never overwritten.
test('the Codex installer writes every command skill under a dd- prefix', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dd-codex-skills-'));
  await mkdir(join(project, '.git'));
  await writeFile(join(project, 'package.json'), '{"name":"fixture"}');
  const plan = await planCodexInstall(project);
  const skills = plan.operations.map(op => op.path.replaceAll('\\', '/')).filter(p => p.includes('/.agents/skills/'))
    .map(p => p.split('/.agents/skills/')[1]).sort();
  assert.deepEqual(skills, COMMANDS.map(name => `dd-${name}/SKILL.md`).sort());
  const review = plan.operations.find(op => op.path.replaceAll('\\', '/').endsWith('dd-review/SKILL.md'));
  assert.match(String(review.content ?? review.value ?? ''), /^---\r?\nname: dd-review\r?\n/);
});

// Reinstalling replaces the skills DD wrote; a project skill DD never wrote stops the install.
test('reinstalling replaces the Codex skills DD wrote and stops at one it did not', async () => {
  const { applyCodexInstall } = await import('../../scripts/install-codex.mjs');
  const project = await mkdtemp(join(tmpdir(), 'dd-codex-upgrade-'));
  await mkdir(join(project, '.git'));
  await writeFile(join(project, 'package.json'), '{"name":"fixture"}');
  await mkdir(join(project, '.agents', 'skills', 'dd-save'), { recursive: true });
  await writeFile(join(project, '.agents', 'skills', 'dd-save', 'SKILL.md'), '---\nname: dd-save\ndescription: An older copy.\n---\n\nOld body.\n');
  await applyCodexInstall(await planCodexInstall(project));
  assert.match(await readFile(join(project, '.agents', 'skills', 'dd-save', 'SKILL.md'), 'utf8'), /^---\r?\nname: dd-save\r?\ndescription: Save/);
  await writeFile(join(project, '.agents', 'skills', 'dd-review', 'SKILL.md'), '---\nname: my-review\n---\nMine.\n');
  await assert.rejects(planCodexInstall(project), /existing_skill_requires_review/);
});

// A marketplace install is a checkout in Claude Code's plugin cache with no
// `deltadictum` on PATH: `npx deltadictum` would fetch the published package from
// npm (a network request, and possibly another version than the hooks). Claude
// Code substitutes ${CLAUDE_PLUGIN_ROOT} in a skill's body.
test('the recall and review skills run the CLI of the installed plugin, never npx', async () => {
  for (const [name, command] of [['recall', 'recall'], ['review', 'ui']]) {
    const text = await read(`skills/${name}/SKILL.md`);
    assert.match(text, new RegExp(`node "\\$\\{CLAUDE_PLUGIN_ROOT\\}/src/cli\\.js" ${command}\\b`), name);
    assert.doesNotMatch(text, /npx/, name);
  }
});

// Codex substitutes nothing: its copies name the directory DD runs from, the
// same one the hooks name.
test('the Codex copies of the skills name the plugin root in place of CLAUDE_PLUGIN_ROOT', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dd-codex-skill-root-'));
  await mkdir(join(project, '.git'));
  const plan = await planCodexInstall(project);
  const root = plan.pluginRoot.replaceAll('\\', '/');
  for (const [name, command] of [['recall', 'recall'], ['review', 'ui']]) {
    const content = String(plan.operations.find(op => op.path.replaceAll('\\', '/').endsWith(`dd-${name}/SKILL.md`)).content);
    assert.ok(content.includes(`node "${root}/src/cli.js" ${command}`), content);
    assert.doesNotMatch(content, /CLAUDE_PLUGIN_ROOT|npx/);
  }
});

// A Codex install names the hooks entry point and registers no MCP server: DD has none.
test('the Codex installer points its hooks at hooks/run.cjs and registers no MCP server', async () => {
  const project = await mkdtemp(join(tmpdir(), 'dd-codex-hooks-'));
  await mkdir(join(project, '.git'));
  const plan = await planCodexInstall(project);
  const content = suffix => String(plan.operations.find(op => op.path.replaceAll('\\', '/').endsWith(suffix))?.content ?? '');
  const hooks = JSON.parse(content('.codex/hooks.json'));
  const commands = Object.values(hooks.hooks).flat().flatMap(group => group.hooks).map(hook => hook.command);
  assert.ok(commands.length > 0);
  for (const command of commands) assert.match(command, /hooks\/run\.cjs' '[a-z-]+' '--codex'/);
  assert.doesNotMatch(content('.codex/config.toml'), /\[mcp_servers\.dd\]/);
});
