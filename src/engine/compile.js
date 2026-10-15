import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultWhen, exampleProblems } from '../checks/check.cjs';
import { createMatcher } from '../checks/pattern.cjs';
import { DIMENSIONS, globToRegExp, shellTokens } from './clause.cjs';
import { INDEX_VERSION, memoryFilesFingerprint, readJson } from './index-file.cjs';
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

function compileCheck(memoryId, check) {
  const compiled = { m: memoryId, on: check.on, when: defaultWhen(check), say: check.say };
  if (check.paths?.length) compiled.paths = check.paths.map(glob => globToRegExp(glob).source);
  for (const key of ['if_content', 'unless_content', 'if_command', 'unless_command']) if (check[key]) compiled[key] = check[key];
  return compiled;
}

// Triggers that can never fire, or that fire on a large share of the repository
// (spec section 3, review note on clause breadth). Reported, never dropped.
export function triggerWarnings(memory, repoFiles, symbolExists) {
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

export function compileIndex({ memories, manifest, fingerprint = null, repoFiles = null, symbolExists = null, bodiesFile = null }) {
  const live = memories.filter(memory => LIVE_STATUSES.includes(memory.status));
  const index = { version: INDEX_VERSION, manifest: { count: manifest?.count ?? 0, hash: manifest?.hash ?? '' }, fingerprint,
    bodies: bodiesFile, memories: {}, clauses: [], checks: [] };
  const bodies = {};
  const warnings = [];
  const matcher = createMatcher();
  for (const memory of live) {
    index.memories[memory.id] = { title: memory.title, kind: memory.kind, status: memory.status };
    for (const clause of memory.triggers) index.clauses.push(compileClause(memory.id, clause));
    bodies[memory.id] = { body: memory.body,
      evidence: memory.evidence.filter(e => e.type === 'file' && e.sha256).map(e => ({ path: e.path, sha256: e.sha256 })) };
    warnings.push(...triggerWarnings(memory, repoFiles, symbolExists));
    // A check that does not behave as its examples say never reaches a hook.
    if (memory.check) {
      const problems = exampleProblems(memory.check, matcher);
      if (problems.length) warnings.push(...problems.map(value => ({ memory: memory.id, kind: 'check_examples_fail', value })));
      else index.checks.push(compileCheck(memory.id, memory.check));
    }
  }
  return { index, bodies, warnings };
}

// Windows refuses a rename over a file another process has open for a moment
// (a hook reading the index): retried briefly, then the error stands.
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRY_DELAYS_MS = [10, 20, 40, 80];
function renameRetrying(from, to, rename) {
  for (let attempt = 0; ; attempt += 1) {
    try { return rename(from, to); } catch (err) {
      if (!RETRY_CODES.has(err.code) || attempt >= RETRY_DELAYS_MS.length) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_DELAYS_MS[attempt]);
    }
  }
}

const newBodiesName = () => `bodies-${Date.now().toString(36)}${randomBytes(4).toString('hex')}.json`;

// Bodies of other builds go once they are old enough that no hook still holds an
// index naming them, and no compile running at the same moment just wrote them.
const RETAIN_MS = 60 * 1000;
function pruneBodies(dir, keep, now) {
  for (const name of readdirSync(dir)) {
    if (!/^bodies.*\.json$/.test(name) || keep.includes(name)) continue;
    try { if (now - statSync(join(dir, name)).mtimeMs > RETAIN_MS) rmSync(join(dir, name), { force: true }); } catch { /* gone */ }
  }
}

// Each build writes its own bodies file, then the index that names it: a hook
// holding either index finds the bodies of its build. The previous build's
// bodies stay for a hook that read the previous index; older ones are removed.
export function writeCompiled(paths, { index, bodies }, { rename = renameSync, now = Date.now() } = {}) {
  mkdirSync(paths.v2, { recursive: true });
  const named = { ...index, bodies: index.bodies ?? newBodiesName() };
  const previous = readJson(paths.index)?.bodies;
  for (const [file, value] of [[join(paths.v2, named.bodies), bodies], [paths.index, named]]) {
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(value));
    try { renameRetrying(temp, file, rename); } finally { rmSync(temp, { force: true }); }
  }
  pruneBodies(paths.v2, [named.bodies, previous], now);
}

function gitLines(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).split('\n').filter(Boolean); }
  catch { return null; }
}

// The repository's tracked files, or null when git cannot answer.
export const repoFilesOf = root => gitLines(root, ['ls-files']);
// Untracked files git does not ignore: new work not yet added.
export const untrackedFilesOf = root => gitLines(root, ['ls-files', '--others', '--exclude-standard']);

// The trigger symbols the project's code holds, in one git grep over tracked
// files. DD's own files are excluded: a memory names its own symbols. null when
// git cannot answer, so no symbol is reported dead on a guess.
export function codeSymbols(root, symbols) {
  if (!symbols.length) return new Set();
  try {
    const out = execFileSync('git', ['-C', root, 'grep', '-h', '-o', '-w', '-F', '-I', '-f', '-', '--', '.', ':(exclude).dd'],
      { input: `${symbols.join('\n')}\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
    return new Set(out.split('\n').map(line => line.trim()).filter(Boolean));
  } catch (err) { return err.status === 1 ? new Set() : null; }
}

export async function compileProject(root) {
  const paths = localPaths(root);
  const store = createMemoryFiles(paths.dd);
  // The manifest is derived and git-ignored: rebuilt when a clone lacks it or a pull outdated it.
  await store.refreshManifest();
  const all = await store.list();
  const manifest = await store.manifest();
  // Tracked files plus new work not yet added: a glob over either is live; ignored files are absent.
  const tracked = repoFilesOf(root);
  const repoFiles = tracked ? [...new Set([...tracked, ...(untrackedFilesOf(root) ?? [])])] : null;
  const found = repoFiles ? codeSymbols(root, [...new Set(all.flatMap(memory => (memory.triggers ?? []).flatMap(clause => clause.symbols ?? [])))]) : null;
  const symbolExists = found ? symbol => found.has(symbol) : null;
  const compiled = compileIndex({ memories: all, manifest, fingerprint: memoryFilesFingerprint(paths.memories), repoFiles, symbolExists });
  await ensureIgnored(paths.dd);
  writeCompiled(paths, compiled);
  return { memories: Object.keys(compiled.index.memories).length, clauses: compiled.index.clauses.length, warnings: compiled.warnings };
}
