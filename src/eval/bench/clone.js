// A fresh clone per run, ready for its condition. Each condition gets the
// project's knowledge through one channel only; a rule the project's own
// CLAUDE.md or AGENTS.md states is removed in all four (validity rule 3), and
// the agent's change is everything after the baseline commit.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installStore, materializeMemories, writeGuide } from './store.js';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024 }).toString();

async function strip(dir, entries) {
  for (const { file, line } of entries) {
    const path = join(dir, file);
    const lines = (await readFile(path, 'utf8').catch(() => '')).split('\n');
    if (!lines.some(l => l.trimEnd() === line)) throw new Error(`strip_not_found: ${file}: ${line}`);
    await writeFile(path, lines.filter(l => l.trimEnd() !== line).join('\n'));
  }
}

export async function prepareClone(project, task, condition) {
  const base = task.base ?? project.base;
  const dir = join(await mkdtemp(join(tmpdir(), 'dd-bench-')), project.id);
  execFileSync('git', ['clone', '-q', project.repo, dir]);
  git(dir, 'checkout', '-q', base);
  await project.link?.(dir, base);
  await strip(dir, project.strip ?? []);
  if (task.setup) await task.setup(dir);
  let warnings = [], indexMemories = null;
  if (condition === 'doc' || condition === 'docref') {
    const { memories, warnings: found } = await materializeMemories(dir, project);
    warnings = found;
    await writeGuide(dir, project, memories, condition === 'docref');
  }
  if (condition === 'dd2') ({ warnings, index_memories: indexMemories } = await installStore(dir, project));
  else await rm(join(dir, '.dd'), { recursive: true, force: true });
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'eval baseline');
  return { dir, store_warnings: warnings, index_memories: indexMemories };
}

// Links first: a recursive delete that follows a junction empties its target.
export async function removeClone(dir, project) {
  for (const link of project.links ?? []) await unlink(join(dir, link)).catch(() => {});
  await rm(join(dir, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }).catch(() => {});
}
