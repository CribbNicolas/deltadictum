'use strict';

const { readdirSync, readFileSync, statSync } = require('node:fs');
const { join } = require('node:path');
const { localPaths } = require('./locate.cjs');

// The compiled index as the hot path reads it. A hook only compares the
// manifest's hash with the index's (0.3 ms, bench decision 4); session start also
// compares a fingerprint of the memory files, which catches hand edits and git
// pulls that never rewrote the manifest.
const INDEX_VERSION = 2;

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
}

const loadIndex = root => readJson(localPaths(root).index);
const readBodies = root => readJson(localPaths(root).bodies);
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

const needsCompile = (index, root) => isStale(index, root) || index.fingerprint !== memoryFilesFingerprint(localPaths(root).memories);

module.exports = { INDEX_VERSION, readJson, loadIndex, readBodies, manifestHash, isStale, memoryFilesFingerprint, needsCompile };
