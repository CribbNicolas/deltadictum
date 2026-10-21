'use strict';

const { existsSync } = require('node:fs');
const { homedir } = require('node:os');
const { dirname, join, resolve } = require('node:path');

const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);

// The nearest folder at or above `start` that holds .dd or .git, never the stop
// folder (the user's home) or above it: the home contains everything. A project
// opts into DD with its .dd/ folder: its memories, or only a committed
// .dd/config.json before the first memory.
function findProjectRoot(start, { stopAt = homedir() } = {}) {
  const boundary = resolve(stopAt);
  let dir = resolve(start);
  while (!same(dir, boundary)) {
    if (existsSync(join(dir, '.dd')) || existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

// Every file DD keeps for a project. `local/` is git-ignored through .dd/.gitignore.
function localPaths(root) {
  const dd = join(root, '.dd');
  const local = join(dd, 'local');
  const compiled = join(local, 'compiled');
  return { dd, memories: join(dd, 'memories'), manifest: join(dd, 'memories', 'manifest.json'), local, compiled,
    index: join(compiled, 'index.json'), sessions: join(local, 'sessions') };
}

module.exports = { findProjectRoot, localPaths };
