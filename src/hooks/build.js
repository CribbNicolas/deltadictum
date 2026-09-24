import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePath, physicalPath, samePath } from '../paths.js';

export { normalizePath, samePath };

// The DD source tree this process runs from. A hook takes a bridged answer only
// from an audit UI running the same tree (roadmap gap 7): a plugin cache, an npm
// install and a development checkout are different builds even at one version.
// The id hashes the normalized path, so spellings of one tree (case, symlinks)
// are one build; the tree is walked by its physical path.
export const BUILD_ROOT = physicalPath(dirname(dirname(fileURLToPath(import.meta.url))));
export const BUILD_ID = createHash('sha256').update(normalizePath(BUILD_ROOT)).digest('hex').slice(0, 16);

// The package version this tree ships. Installs of one version (a plugin, an npm
// install, a checkout) share a resident instead of replacing each other's (L2);
// null when it cannot be read, which shares with nothing.
export const VERSION = (() => {
  try { return JSON.parse(readFileSync(join(dirname(BUILD_ROOT), 'package.json'), 'utf8')).version ?? null; }
  catch { return null; }
})();

// Whether a resident's reply may stand for this install: the same tree, or an
// unchanged process of the same version.
export function compatibleBuild({ build, version }) {
  return build === BUILD_ID || (VERSION !== null && version === VERSION);
}

// Numeric comparison of dotted versions; anything unreadable counts as older.
export function compareVersions(a, b) {
  const parts = v => String(v ?? '').split(/[.+-]/).slice(0, 3).map(n => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

// Size and mtime of every source file. Only the long-lived audit UI computes
// this, to notice that the tree it started from has since been edited; hooks
// never walk the tree (L1).
export async function codeFingerprint(root = BUILD_ROOT) {
  const hash = createHash('sha256');
  async function walk(dir) {
    const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else { const info = await stat(path); hash.update(`${path}\0${info.size}\0${info.mtimeMs}\n`); }
    }
  }
  await walk(root);
  return hash.digest('hex');
}
