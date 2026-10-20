// A fresh clone per run, ready for its condition. Each condition gets the
// project's knowledge through one channel only (docdd through both); a rule the project's own
// CLAUDE.md or AGENTS.md states is removed in all four (validity rule 3), and
// the agent's change is everything after the baseline commit.
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseCommit, cleanHistory, treeFiles, uploadPackFor } from './history.js';
import { GUIDE, WITH_DD } from './situations.js';
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

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const historyCache = () => process.env.DD_BENCH_HISTORY ?? join(REPO, 'output', 'eval', 'bench', 'history');

// One local branch at the base and nothing else: no remote (a push would reach the source repository) and
// only the objects the base reaches, so no other branch, tag or commit (a mined task's fix, the bench's own
// solutions) is in the clone even as an unreachable object. The base comes from the project's history
// rewritten without DD's store (history.js), the same commits in every condition, so no agent reads the
// memories with `git log -p`. A source repository owned by another account (a sandbox user) is trusted for
// the rewrite's fetch only (uploadPackFor).
async function fetchBase(project, base, dir) {
  const { repo, commit } = await cleanHistory({ repo: project.repo, base, strip: project.historyStrip ?? ['.dd'], cacheDir: historyCache() });
  await mkdir(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'fetch', '-q', '--no-tags', '--upload-pack', uploadPackFor(repo), repo, commit);
  git(dir, 'checkout', '-q', '-B', 'main', commit);
  await rm(join(dir, '.git', 'FETCH_HEAD'), { force: true });
  git(dir, 'reflog', 'expire', '--expire=now', '--all');
  return commit;
}

// A project that keeps its own store gets it back from the base tree, in dd2 only.
async function restoreStore(project, base, dir) {
  for (const { path, content } of treeFiles(project.repo, baseCommit(project.repo, base), project.historyStrip ?? ['.dd'])) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
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
    const baseCommitId = await fetchBase(project, base, dir);
    await project.link?.(dir, base);
    checkLinks(dir, project.links ?? []);
    await strip(dir, project.strip ?? []);
    // What a project needs removed or changed in every condition (a committed plugin setting, say).
    await project.prepare?.(dir);
    let warnings = [], indexMemories = null, compileWarnings = [];
    if (GUIDE[condition]) {
      const { memories, warnings: found } = await materializeMemories(dir, project);
      warnings = found;
      await writeGuide(dir, project, memories, GUIDE[condition] === 'referenced');
    }
    if (WITH_DD.includes(condition) && project.store === 'existing') await restoreStore(project, base, dir);
    if (WITH_DD.includes(condition)) ({ warnings, index_memories: indexMemories, compile_warnings: compileWarnings } = await installStore(dir, project));
    else await rm(join(dir, '.dd'), { recursive: true, force: true });
    // The starting point is the project's own history. The stripped lines, the prepare step and the
    // condition's files are one commit by its team; a task's setup (the teammate's change a prompt calls
    // "the last commit") is the next, so HEAD shows the same change in every condition.
    teamCommit(dir, project, 'Update');
    if (task.setup) {
      await task.setup(dir);
      teamCommit(dir, project, task.setupMessage ?? 'Update');
    }
    return { dir, base_commit: baseCommitId, baseline: git(dir, 'rev-parse', 'HEAD').trim(), store_warnings: warnings, compile_warnings: compileWarnings, index_memories: indexMemories };
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
