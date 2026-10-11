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
  // v2 ships three skills: the ones DD wrote and no longer ships are retired too.
  await assert.rejects(access(join(project, '.agents', 'skills', 'dd-audit', 'SKILL.md')));
  assert.match(await readFile(join(project, '.agents', 'skills', 'dd-save', 'SKILL.md'), 'utf8'), /^---\r?\nname: dd-save\r?\n/);
  await writeFile(join(project, '.agents', 'skills', 'dd-review', 'SKILL.md'), '---\nname: my-review\n---\nMine.\n');
  await assert.rejects(planCodexInstall(project), /existing_skill_requires_review/);
});
