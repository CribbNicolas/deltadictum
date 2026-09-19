import { homedir } from 'node:os';
import { join, basename, dirname, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { createMemoryStore } from './store/create-store.js';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// A project `.dd` holds knowledge. The per-user data base holds one rebuildable
// cache directory per project and none of these markers, so the two are
// distinguishable without guessing.
const PROJECT_MARKERS = ['atoms', 'candidates', 'registry', 'config.json'];

async function isProjectStore(ddDir) {
  for (const marker of PROJECT_MARKERS) if (await exists(join(ddDir, marker))) return true;
  return false;
}

/**
 * Resolve the project root by walking up from `start`.
 *
 * The walk stops below `stopAt`, the user's home by default. An ancestor at or
 * above the home must never capture a directory beneath it: the home contains
 * everything, so accepting it as a project root merges unrelated work into one
 * store and breaks project isolation (INV-01). Pointing at the home directly is
 * a deliberate choice and stays available.
 */
export async function findRepoRoot(start = process.cwd(), { stopAt = homedir() } = {}) {
  const boundary = resolve(stopAt);
  let dir = resolve(start);
  while (dir !== boundary) {
    if (await exists(join(dir, '.git'))) return dir;
    if (await isProjectStore(join(dir, '.dd'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export function projectSlug(repoRoot) {
  return basename(repoRoot).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

// Deliberately not `~/.dd`: that made the per-user cache indistinguishable
// from a project marker, so the home resolved as a project root.
export function resolveDataBase() {
  return process.env.GROK_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.dd-data');
}

export async function openStore({ cwd = process.env.DD_PROJECT_DIR || process.cwd() } = {}) {
  const repoRoot = await findRepoRoot(cwd);
  const ddDir = join(repoRoot, '.dd');
  const slug = projectSlug(repoRoot);
  const identity = createHash('sha256').update(resolve(repoRoot)).digest('hex').slice(0, 12);
  const dataBase = resolveDataBase();
  const dataDir = process.env.DD_DATA || join(dataBase, `${slug}-${identity}`);
  const store = await createMemoryStore({ ddDir, dataDir, repoRoot });
  const config = await store.withWriteLock(async () => {
    const current = await store.loadConfig();
    if (!current.project_id) {
      current.project_id = `${slug}-${randomUUID().slice(0, 8)}`;
      await store.saveConfig(current);
    }
    return current;
  });
  return { store, repoRoot, ddDir, dataDir, config, projectId: config.project_id };
}

export async function readJsonStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { prompt: raw, text: raw };
  }
}
