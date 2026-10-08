import { execFileSync } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DIMENSIONS, globToRegExp, shellTokens } from './clause.cjs';
import { INDEX_VERSION, memoryFilesFingerprint } from './index-file.cjs';
import { localPaths } from './locate.cjs';
import { words } from './text.cjs';
import { ensureIgnored } from '../memory/ignore.js';
import { LIVE_STATUSES } from '../memory/schema.js';
import { createMemoryFiles } from '../memory/store.js';

// Memories compiled for the hot path (spec section 3): the index holds only what
// matching needs, precompiled; bodies are read only when something fires. Runs at
// write time, at session start when the index is stale, and on demand.
export { INDEX_VERSION };
const BROAD_FILES = 20;
const BROAD_SHARE = 0.25;

function compileClause(memoryId, clause) {
  const compiled = { m: memoryId, on: clause.on, dims: DIMENSIONS.filter(d => Array.isArray(clause[d]) && clause[d].length) };
  if (clause.paths?.length) compiled.paths = clause.paths.map(glob => globToRegExp(glob).source);
  if (clause.symbols?.length) compiled.symbols = clause.symbols;
  if (clause.commands?.length) compiled.commands = clause.commands.map(shellTokens);
  if (clause.keywords?.length) compiled.keywords = clause.keywords.map(words);
  if (clause.not?.length) compiled.not = clause.not.map(words);
  if (clause.not_paths?.length) compiled.not_paths = clause.not_paths.map(glob => globToRegExp(glob).source);
  return compiled;
}

// Triggers that can never fire, or that fire on a large share of the repository
// (spec section 3, review note on clause breadth). Reported, never dropped.
function triggerWarnings(memory, repoFiles, symbolExists) {
  const warnings = [];
  for (const clause of memory.triggers) {
    for (const glob of clause.paths ?? []) {
      if (!repoFiles) continue;
      const regex = globToRegExp(glob);
      const files = repoFiles.filter(file => regex.test(file)).length;
      if (!files) warnings.push({ memory: memory.id, kind: 'dead_glob', value: glob });
      else if (files >= BROAD_FILES && files / repoFiles.length > BROAD_SHARE) warnings.push({ memory: memory.id, kind: 'broad_glob', value: glob, files });
    }
    for (const symbol of clause.symbols ?? []) {
      if (symbolExists && !symbolExists(symbol)) warnings.push({ memory: memory.id, kind: 'dead_symbol', value: symbol });
    }
  }
  return warnings;
}

export function compileIndex({ memories, manifest, fingerprint = null, repoFiles = null, symbolExists = null }) {
  const live = memories.filter(memory => LIVE_STATUSES.includes(memory.status));
  const index = { version: INDEX_VERSION, manifest: { count: manifest?.count ?? 0, hash: manifest?.hash ?? '' }, fingerprint,
    memories: {}, clauses: [] };
  const bodies = {};
  const warnings = [];
  for (const memory of live) {
    index.memories[memory.id] = { title: memory.title, kind: memory.kind, status: memory.status };
    for (const clause of memory.triggers) index.clauses.push(compileClause(memory.id, clause));
    bodies[memory.id] = { body: memory.body,
      evidence: memory.evidence.filter(e => e.type === 'file' && e.sha256).map(e => ({ path: e.path, sha256: e.sha256 })) };
    warnings.push(...triggerWarnings(memory, repoFiles, symbolExists));
  }
  return { index, bodies, warnings };
}

// Bodies first, then the index: a reader that sees the new index finds its bodies.
export function writeCompiled(paths, { index, bodies }) {
  mkdirSync(paths.v2, { recursive: true });
  for (const [file, value] of [[paths.bodies, bodies], [paths.index, index]]) {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value));
    try { renameSync(temp, file); } finally { rmSync(temp, { force: true }); }
  }
}

function gitLines(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split('\n').filter(Boolean); }
  catch { return null; }
}

export async function compileProject(root) {
  const paths = localPaths(root);
  const store = createMemoryFiles(paths.dd);
  // The manifest is derived and git-ignored: rebuilt when a clone lacks it or a pull outdated it.
  await store.refreshManifest();
  const all = await store.list();
  const manifest = await store.manifest();
  const repoFiles = gitLines(root, ['ls-files']);
  // git grep -l exits 1 (null here) when nothing matches.
  const symbolExists = repoFiles ? symbol => gitLines(root, ['grep', '-l', '-w', '-F', '-e', symbol]) !== null : null;
  const compiled = compileIndex({ memories: all, manifest, fingerprint: memoryFilesFingerprint(paths.memories), repoFiles, symbolExists });
  await ensureIgnored(paths.dd);
  writeCompiled(paths, compiled);
  return { memories: Object.keys(compiled.index.memories).length, clauses: compiled.index.clauses.length, warnings: compiled.warnings };
}
