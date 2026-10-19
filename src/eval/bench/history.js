// A project's history up to a bench base without DD's store in any commit, so that no condition can read
// the memories with `git log -p` (deferred minor M9 of the full benchmark's review). Built once per
// project, base and strip list into a bare repository under the cache; every condition's clone fetches its
// base from there, so all four start from the same rewritten commits. The source repository is only read.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const run = (dir, args, env) => execFileSync('git', ['-C', dir, ...args], { maxBuffer: 64 * 1024 * 1024, env: env ? { ...process.env, ...env } : process.env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const quote = path => `'${String(path).replaceAll("'", "'\\''")}'`;

// The upload-pack settings a fetch from another account's repository needs: git clears GIT_CONFIG_* for a
// local transport, so they ride on the command, which also lets a commit be asked for by its id.
export const uploadPackFor = repo => {
  const source = resolve(repo).replaceAll('\\', '/');
  return `git -c "safe.directory=${source}" -c "safe.directory=${source}/.git" -c uploadpack.allowAnySHA1InWant=true upload-pack`;
};

export const baseCommit = (repo, base) => {
  const source = resolve(repo).replaceAll('\\', '/');
  return execFileSync('git', ['-c', `safe.directory=${source}`, '-C', repo, 'rev-parse', `${base}^{commit}`]).toString().trim();
};

// The files under `paths` in a commit of the source, read with one cat-file process: a project that
// keeps its own store gets it back in its dd2 clone from the base tree, not from history.
export function treeFiles(repo, commit, paths) {
  const source = resolve(repo).replaceAll('\\', '/');
  const read = (args, input) => execFileSync('git', ['-c', `safe.directory=${source}`, '-C', repo, ...args], { input, maxBuffer: 256 * 1024 * 1024 });
  const entries = read(['ls-tree', '-r', '-z', commit, '--', ...paths]).toString('utf8').split('\0').filter(Boolean)
    .map(line => { const [meta, path] = line.split('\t'); const [mode, type, sha] = meta.split(' '); return { mode, type, sha, path }; })
    .filter(entry => entry.type === 'blob' && entry.mode !== '120000');
  if (!entries.length) return [];
  const out = read(['cat-file', '--batch'], `${entries.map(entry => entry.sha).join('\n')}\n`);
  let at = 0;
  return entries.map(entry => {
    const header = out.indexOf(0x0a, at);
    const size = Number(out.toString('utf8', at, header).split(' ')[2]);
    const content = out.subarray(header + 1, header + 1 + size);
    at = header + 1 + size + 1;
    return { path: entry.path, content };
  });
}

export async function cleanHistory({ repo, base, strip = ['.dd'], cacheDir }) {
  const source = resolve(repo).replaceAll('\\', '/');
  const commit = baseCommit(repo, base);
  const key = createHash('sha256').update(`${source}\0${commit}\0${strip.join('\0')}`).digest('hex').slice(0, 16);
  const target = join(cacheDir, `${key}.git`);
  if (!existsSync(target)) {
    await mkdir(cacheDir, { recursive: true });
    // Built aside and renamed into place: a worker that loses the race uses the winner's entry.
    const temp = await mkdtemp(join(cacheDir, `.build-${key}-`));
    try {
      run(temp, ['init', '-q', '--bare', '-b', 'main']);
      run(temp, ['fetch', '-q', '--no-tags', '--upload-pack', uploadPackFor(repo), repo, `${commit}:refs/heads/main`]);
      if (strip.length) {
        run(temp, ['filter-branch', '-f', '--index-filter', `git rm -r -q --cached --ignore-unmatch -- ${strip.map(quote).join(' ')}`, '--', '--all'],
          { FILTER_BRANCH_SQUELCH_WARNING: '1' });
        // The old commits stay reachable from refs/original/ until it is deleted.
        for (const ref of run(temp, ['for-each-ref', '--format=%(refname)', 'refs/original/']).split('\n').filter(Boolean)) run(temp, ['update-ref', '-d', ref]);
      }
      run(temp, ['reflog', 'expire', '--expire=now', '--all']);
      run(temp, ['gc', '-q', '--prune=now']);
      await rename(temp, target).catch(err => { if (!existsSync(target)) throw err; });
    } finally {
      await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  return { repo: target, commit: run(target, ['rev-parse', 'refs/heads/main']).trim() };
}
