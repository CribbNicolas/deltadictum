#!/usr/bin/env node
// Reports what the legacy per-user data base at ~/.dd contains, and removes it
// only when asked and only when it holds no knowledge.
//
// Until the project-isolation fix, the per-user cache lived at ~/.dd and
// findRepoRoot accepted any `.dd` as a project marker. Opening a store from a
// non-repository path under the home therefore resolved the home as the project
// root and registered it as a project. The cache now lives at ~/.dd-data, so
// ~/.dd is a leftover.
//
// Read-only by default. Pass --remove to delete, which is refused if the
// directory holds knowledge.

import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LEGACY = join(homedir(), '.dd');
const CURRENT = join(homedir(), '.dd-data');
const KNOWLEDGE_DIRS = ['atoms', 'candidates', 'archive', 'registry'];

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function countEntries(path) {
  try { return (await readdir(path)).length; } catch { return 0; }
}

async function inspect(root) {
  if (!await exists(root)) return null;
  const entries = await readdir(root, { withFileTypes: true });
  const knowledge = [];
  for (const name of KNOWLEDGE_DIRS) {
    const count = await countEntries(join(root, name));
    if (count > 0) knowledge.push({ name, count });
  }
  const caches = entries.filter(e => e.isDirectory() && !KNOWLEDGE_DIRS.includes(e.name)).map(e => e.name);
  const files = entries.filter(e => e.isFile()).map(e => e.name);
  let projectId = null;
  try { projectId = JSON.parse(await readFile(join(root, 'config.json'), 'utf8')).project_id ?? null; } catch { /* absent or unreadable */ }
  return { knowledge, caches, files, projectId };
}

const found = await inspect(LEGACY);

if (!found) {
  console.log(`Nothing to do: ${LEGACY} does not exist.`);
  process.exit(0);
}

console.log(`Legacy per-user directory: ${LEGACY}`);
if (found.projectId) {
  console.log(`  Registered as a project: ${found.projectId}`);
  console.log('  This is the artifact of the isolation bug: the home was treated as a project root.');
}
if (found.files.length) console.log(`  Files: ${found.files.join(', ')}`);
if (found.caches.length) console.log(`  Cache directories (${found.caches.length}): ${found.caches.slice(0, 5).join(', ')}${found.caches.length > 5 ? ', …' : ''}`);
if (found.knowledge.length) {
  console.log('  KNOWLEDGE PRESENT:');
  for (const entry of found.knowledge) console.log(`    ${entry.name}/ — ${entry.count} entries`);
}

console.log(`\nCurrent per-user cache: ${CURRENT}${await exists(CURRENT) ? '' : ' (not created yet; it appears on the next run)'}`);

if (found.knowledge.length) {
  console.log('\nRefusing to remove: this directory holds knowledge, not just cache.');
  console.log('Move what you want to keep into the project it belongs to, then delete the directory yourself.');
  process.exit(1);
}

if (!process.argv.includes('--remove')) {
  console.log('\nThis directory holds no knowledge — only cache and the stray project registration.');
  console.log('Caches rebuild from git on the next run, so removing it loses at most local telemetry.');
  console.log('Re-run with --remove to delete it.');
  process.exit(0);
}

await rm(LEGACY, { recursive: true, force: true });
console.log(`\nRemoved ${LEGACY}. Indexes rebuild from git on the next run.`);
