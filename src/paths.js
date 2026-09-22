import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

// Paths that name the same place must compare equal across processes, which
// spell them differently: a harness passes the directory the user opened
// (possibly through a symlink; macOS /tmp and /var are symlinks to /private),
// process.cwd() is the physical path, and Windows and default macOS volumes
// ignore case. Use these helpers wherever a path is compared or hashed; use
// the path itself for filesystem access.
const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

// The physical path, resolved through symlinks. A path that does not exist yet
// (a file about to be written) is resolved through its nearest existing parent.
export function physicalPath(path) {
  let current = resolve(path);
  const rest = [];
  for (;;) {
    try { return join(realpathSync.native(current), ...rest); }
    catch {
      const parent = dirname(current);
      if (parent === current) return resolve(path);
      rest.unshift(basename(current));
      current = parent;
    }
  }
}

// A comparison and hashing key, never a path to open: case is folded on
// case-insensitive platforms, which a case-sensitive volume would not accept.
export function normalizePath(path) {
  const physical = physicalPath(path);
  return CASE_INSENSITIVE ? physical.toLowerCase() : physical;
}

export const samePath = (a, b) => normalizePath(a) === normalizePath(b);

// A file's path relative to the project root, tried as spelled first and then
// physically, so a root reached through a symlink still contains its files.
export function projectRelative(root, file) {
  const spelled = relative(root, file);
  if (!spelled.startsWith('..') && !isAbsolute(spelled)) return spelled.replaceAll('\\', '/');
  const physical = relative(physicalPath(root), physicalPath(file));
  return (!physical.startsWith('..') && !isAbsolute(physical) ? physical : spelled).replaceAll('\\', '/');
}
