'use strict';

const { existsSync, readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { localPaths } = require('./locate.cjs');

// The compiled index as the hot path reads it. A hook only compares the
// manifest's hash with the index's (0.3 ms, bench decision 4); session start also
// compares a fingerprint of the memory files, which catches hand edits and git
// pulls that never rewrote the manifest.
// Version 3: each build writes its own bodies file, named by the index.
// Version 4: the index carries checks.
const INDEX_VERSION = 4;

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

// An index of another version is not read as this one: hooks ignore it until
// session start recompiles.
function loadIndex(root) {
  const index = readJson(localPaths(root).index);
  return index?.version === INDEX_VERSION ? index : null;
}

// The bodies of the build that wrote this index, so a hook never pairs an index
// with another build's bodies. Only a plain name inside the index folder is read.
const BODIES_NAME = /^bodies-[a-z0-9]+\.json$/;
function readBodies(root, index) {
  const name = index?.bodies;
  return typeof name === 'string' && BODIES_NAME.test(name) ? readJson(join(localPaths(root).v2, name)) : null;
}
const manifestHash = root => readJson(localPaths(root).manifest)?.hash ?? null;

function isStale(index, root) {
  return !index || index.version !== INDEX_VERSION || index.manifest?.hash !== (manifestHash(root) ?? '');
}

function memoryFilesFingerprint(memoriesDir) {
  let count = 0, newest = 0, size = 0;
  let names = [];
  try { names = readdirSync(memoriesDir); } catch { return '0:0:0'; }
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'manifest.json') continue;
    try {
      const info = statSync(join(memoriesDir, name));
      count += 1; newest = Math.max(newest, info.mtimeMs); size += info.size;
    } catch { /* removed while listing */ }
  }
  return `${count}:${newest}:${size}`;
}

// Session start also rebuilds an index whose bodies file is gone (two compiles
// that overlapped, a hand deletion): hooks deliver nothing from it meanwhile.
const bodiesPresent = (index, root) => typeof index.bodies === 'string' && BODIES_NAME.test(index.bodies) && existsSync(join(localPaths(root).v2, index.bodies));
const needsCompile = (index, root) => isStale(index, root) || index.fingerprint !== memoryFilesFingerprint(localPaths(root).memories)
  || !bodiesPresent(index, root);

module.exports = { INDEX_VERSION, BODIES_NAME, readJson, loadIndex, readBodies, manifestHash, isStale, memoryFilesFingerprint, needsCompile };
