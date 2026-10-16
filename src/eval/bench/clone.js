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

// One local branch at the base and nothing else: no remote (a push would reach the
// source repository), no other branch or tag (a mined task's fix, the bench's own
// branches) and no reflog that still names them.
function isolate(dir, base) {
  git(dir, 'checkout', '-q', '-B', 'bench', base);
  git(dir, 'remote', 'remove', 'origin');
  for (const ref of git(dir, 'for-each-ref', '--format=%(refname)').split('\n').filter(Boolean)) {
    if (ref !== 'refs/heads/bench') git(dir, 'update-ref', '-d', ref);
  }
  git(dir, 'reflog', 'expire', '--expire=now', '--all');
}

// A shared link git does not ignore would be committed, stashed or removed with the change.
function checkLinks(dir, links) {
  for (const link of links) {
    try { git(dir, 'check-ignore', '-q', link); } catch { throw new Error(`link_not_ignored: ${link}`); }
  }
}

export async function prepareClone(project, task, condition) {
  const base = task.base ?? project.base;
  const dir = join(await mkdtemp(join(tmpdir(), 'dd-bench-')), project.id);
  try {
    execFileSync('git', ['clone', '-q', project.repo, dir]);
    isolate(dir, base);
    await project.link?.(dir, base);
    checkLinks(dir, project.links ?? []);
    await strip(dir, project.strip ?? []);
    if (task.setup) await task.setup(dir);
    // The starting point is the project's own history: a setup and the stripped lines are a commit by
    // its team, so the baseline commit's diff shows only the condition's files.
    if (git(dir, 'status', '--porcelain').trim()) {
      git(dir, 'add', '-A');
      git(dir, '-c', `user.name=${project.id} team`, '-c', `user.email=team@${project.id}.invalid`, 'commit', '-q', '--no-verify', '-m', task.setupMessage ?? 'Update');
    }
    let warnings = [], indexMemories = null, compileWarnings = [];
    if (condition === 'doc' || condition === 'docref') {
      const { memories, warnings: found } = await materializeMemories(dir, project);
      warnings = found;
      await writeGuide(dir, project, memories, condition === 'docref');
    }
    if (condition === 'dd2') ({ warnings, index_memories: indexMemories, compile_warnings: compileWarnings } = await installStore(dir, project));
    else await rm(join(dir, '.dd'), { recursive: true, force: true });
    git(dir, 'add', '-A');
    git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'eval baseline');
    return { dir, baseline: git(dir, 'rev-parse', 'HEAD').trim(), store_warnings: warnings, compile_warnings: compileWarnings, index_memories: indexMemories };
  } catch (err) {
    await removeClone(dir, project);
    throw err;
  }
}

// Links first: a recursive delete that follows a junction empties its target.
export async function removeClone(dir, project) {
  for (const link of project.links ?? []) await unlink(join(dir, link)).catch(() => {});
  await rm(join(dir, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }).catch(() => {});
}
