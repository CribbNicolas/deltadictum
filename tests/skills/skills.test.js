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

// Review finding 3: a project installed by 0.3.x holds dd, dd-save and dd-audit.
// Reinstalling replaces DD's own skills and removes the retired one; a project
// skill DD never wrote still stops the install.
test('reinstalling over a 0.3.x Codex install replaces the skills DD wrote', async () => {
  const { applyCodexInstall } = await import('../../scripts/install-codex.mjs');
  const project = await mkdtemp(join(tmpdir(), 'dd-codex-upgrade-'));
  await mkdir(join(project, '.git'));
  await writeFile(join(project, 'package.json'), '{"name":"fixture"}');
  for (const old of ['dd', 'dd-save', 'dd-audit']) {
    await mkdir(join(project, '.agents', 'skills', old), { recursive: true });
    await writeFile(join(project, '.agents', 'skills', old, 'SKILL.md'), `---\nname: ${old}\ndescription: As 0.3.x wrote it.\n---\n\nOld body.\n`);
  }
  await applyCodexInstall(await planCodexInstall(project));
  const { access } = await import('node:fs/promises');
  await assert.rejects(access(join(project, '.agents', 'skills', 'dd', 'SKILL.md')));
  assert.match(await readFile(join(project, '.agents', 'skills', 'dd-audit', 'SKILL.md'), 'utf8'), /^---\r?\nname: dd-audit\r?\n/);
  await writeFile(join(project, '.agents', 'skills', 'dd-review', 'SKILL.md'), '---\nname: my-review\n---\nMine.\n');
  await assert.rejects(planCodexInstall(project), /existing_skill_requires_review/);
});
