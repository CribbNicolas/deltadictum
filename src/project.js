import { homedir } from 'node:os';
import { join, basename, dirname } from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { createMemoryStore } from './store/create-store.js';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(start = process.cwd()) {
  let dir = start;
  for (;;) {
    if (await exists(join(dir, '.supermem')) || await exists(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

export function projectSlug(repoRoot) {
  return basename(repoRoot).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
}

export async function openStore({ cwd = process.cwd() } = {}) {
  const repoRoot = await findRepoRoot(cwd);
  const supermemDir = join(repoRoot, '.supermem');
  const slug = projectSlug(repoRoot);
  const dataDir = process.env.SUPERMEM_DATA
    || process.env.GROK_PLUGIN_DATA
    || process.env.CLAUDE_PLUGIN_DATA
    || join(homedir(), '.supermem', slug);
  const store = await createMemoryStore({ supermemDir, dataDir });
  const config = await store.loadConfig();
  if (!config.project_id) {
    config.project_id = slug;
    await store.saveConfig(config);
  }
  return { store, repoRoot, supermemDir, dataDir, config, projectId: config.project_id };
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
