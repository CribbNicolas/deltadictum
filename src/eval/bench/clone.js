// A fresh clone per run, ready for its condition. Each condition gets the
// project's knowledge through one channel only; a rule the project's own
// CLAUDE.md or AGENTS.md states is removed in all four (validity rule 3), and
// the agent's change is everything after the baseline commit.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

// One local branch at the base and nothing else: no remote (a push would reach the source repository) and
// only the objects the base reaches, so no other branch, tag or commit (a mined task's fix, the bench's own
// solutions) is in the clone even as an unreachable object. A source repository owned by another account (a
// sandbox user) is trusted for this fetch only: git clears GIT_CONFIG_* for a local transport, so the
// settings ride on the upload-pack command, which also lets a commit be asked for by its id.
async function fetchBase(repo, base, dir) {
  const source = resolve(repo).replaceAll('\\', '/');
  const commit = execFileSync('git', ['-c', `safe.directory=${source}`, '-C', repo, 'rev-parse', `${base}^{commit}`]).toString().trim();
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  const uploadPack = `git -c "safe.directory=${source}" -c "safe.directory=${source}/.git" -c uploadpack.allowAnySHA1InWant=true upload-pack`;
  git(dir, 'fetch', '-q', '--no-tags', '--upload-pack', uploadPack, repo, commit);
  git(dir, 'checkout', '-q', '-B', 'main', commit);
  await rm(join(dir, '.git', 'FETCH_HEAD'), { force: true });
  git(dir, 'reflog', 'expire', '--expire=now', '--all');
}

const teamCommit = (dir, project, message) => {
  git(dir, 'add', '-A');
  git(dir, '-c', `user.name=${project.id} team`, '-c', `user.email=team@${project.id}.invalid`, 'commit', '-q', '--allow-empty', '--no-verify', '-m', message);
};

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
    await fetchBase(project.repo, base, dir);
    await project.link?.(dir, base);
    checkLinks(dir, project.links ?? []);
    await strip(dir, project.strip ?? []);
    // What a project needs removed or changed in every condition (a committed plugin setting, say).
    await project.prepare?.(dir);
    let warnings = [], indexMemories = null, compileWarnings = [];
    if (condition === 'doc' || condition === 'docref') {
      const { memories, warnings: found } = await materializeMemories(dir, project);
      warnings = found;
      await writeGuide(dir, project, memories, condition === 'docref');
    }
    if (condition === 'dd2') ({ warnings, index_memories: indexMemories, compile_warnings: compileWarnings } = await installStore(dir, project));
    else await rm(join(dir, '.dd'), { recursive: true, force: true });
    // The starting point is the project's own history. The stripped lines, the prepare step and the
    // condition's files are one commit by its team; a task's setup (the teammate's change a prompt calls
    // "the last commit") is the next, so HEAD shows the same change in every condition.
    teamCommit(dir, project, 'Update');
    if (task.setup) {
      await task.setup(dir);
      teamCommit(dir, project, task.setupMessage ?? 'Update');
    }
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
