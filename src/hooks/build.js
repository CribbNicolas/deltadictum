import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The DD source tree this process runs from. A hook takes a bridged answer only
// from an audit UI running the same tree (roadmap gap 7): a plugin cache, an npm
// install and a development checkout are different builds even at one version.
// Windows paths are case-insensitive but a hash is not: `c:\dev` and `C:\dev`
// are the same build, and processes started different ways spell it differently.
export const normalizePath = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
export const BUILD_ROOT = normalizePath(dirname(dirname(fileURLToPath(import.meta.url))));
export const BUILD_ID = createHash('sha256').update(BUILD_ROOT).digest('hex').slice(0, 16);

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
