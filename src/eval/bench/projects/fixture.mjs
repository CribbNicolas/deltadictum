// Builds an invented bench project (docs/superpowers/plans/2026-10-16-bench-02-tollgate.md) into a git
// repository: the final tree in projects/<name>/src/, committed in the order its history.json gives, with
// fixed authors and dates so the commits are the same on every machine. A hash of the source beside the
// repository says whether a build is current; without it, or with another, it is built again from nothing.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECTS = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(PROJECTS, '../../../..');

// Top-level entries the project's own .gitignore names with a leading slash (build output, local
// config): left out of the hash and the copy, as the project's git would leave them out.
function ignored(src) {
  const file = join(src, '.gitignore');
  if (!existsSync(file)) return new Set();
  return new Set(readFileSync(file, 'utf8').split(/\r?\n/).filter(line => line.startsWith('/')).map(line => line.slice(1).replace(/\/$/, '')));
}

function walk(dir, skip, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (dir === base && skip.has(entry.name)) return [];
    return entry.isDirectory() ? walk(path, skip, base) : [path];
  });
}

export function sourceHash(name) {
  const src = join(PROJECTS, name, 'src');
  const hash = createHash('sha256');
  for (const file of walk(src, ignored(src)).sort()) hash.update(`${relative(src, file).replaceAll('\\', '/')}\n`).update(readFileSync(file));
  return hash.update(readFileSync(join(PROJECTS, name, 'history.json'))).digest('hex');
}

export async function buildFixture(name, { out = join(REPO, 'output', 'eval', 'bench', 'projects', name) } = {}) {
  const src = join(PROJECTS, name, 'src');
  const hashFile = `${out}.hash`;
  const hash = sourceHash(name);
  if (existsSync(hashFile) && readFileSync(hashFile, 'utf8') === hash && existsSync(join(out, '.git'))) {
    return { repo: out, head: execFileSync('git', ['-C', out, 'rev-parse', 'HEAD']).toString().trim(), rebuilt: false };
  }
  rmSync(hashFile, { force: true });
  rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  mkdirSync(out, { recursive: true });
  const who = { GIT_AUTHOR_NAME: `${name} team`, GIT_AUTHOR_EMAIL: `team@${name}.invalid`, GIT_COMMITTER_NAME: `${name} team`, GIT_COMMITTER_EMAIL: `team@${name}.invalid` };
  const git = (args, date) => execFileSync('git', ['-C', out, ...args], { env: { ...process.env, ...who,
    ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'core.autocrlf', 'false']);
  const skip = ignored(src);
  const history = JSON.parse(readFileSync(join(PROJECTS, name, 'history.json'), 'utf8'));
  for (const [i, step] of history.entries()) {
    const paths = i === history.length - 1 ? readdirSync(src).filter(entry => !skip.has(entry)) : step.paths;
    for (const path of paths) {
      const from = join(src, path);
      if (!existsSync(from)) throw new Error(`history_path_missing: ${path}`);
      cpSync(from, join(out, path), { recursive: statSync(from).isDirectory() });
    }
    git(['add', '-A']);
    // The machine's own git setup (signing, hooks) must not change or stall the build.
    git(['-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', step.message], step.date);
  }
  writeFileSync(hashFile, hash);
  return { repo: out, head: git(['rev-parse', 'HEAD']).toString().trim(), rebuilt: true };
}
