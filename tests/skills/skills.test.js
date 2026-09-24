import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { planCodexInstall } from '../../scripts/install-codex.mjs';

export const COMMANDS = ['recall', 'audit', 'save', 'review', 'compact', 'clean', 'prospect', 'init'];
const read = path => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

// Claude Code shows plugin skills as /<plugin>:<skill>, so the plugin is named dd.
test('every command skill exists, is named after its directory and is written in English', async () => {
  for (const name of COMMANDS) {
    const text = (await read(`skills/${name}/SKILL.md`)).replace(/\r\n/g, '\n');
    assert.match(text, new RegExp(`^---\\nname: ${name}\\ndescription: .+\\n---\\n`), name);
    assert.doesNotMatch(text, /[áéíóúñ¿¡]/, `${name} must be English`);
  }
  const init = await read('skills/init/SKILL.md');
  assert.match(init, /Before exploring anything/);
  assert.match(init, /\/dd:prospect/);
  assert.equal(JSON.parse(await read('.claude-plugin/plugin.json')).name, 'dd');
  assert.equal(JSON.parse(await read('.claude-plugin/marketplace.json')).plugins[0].name, 'dd');
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
