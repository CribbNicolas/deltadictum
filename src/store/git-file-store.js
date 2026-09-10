import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ARCHIVE_STATES,
  archiveFilePath,
  atomFilePath,
  configPath,
  DEFAULT_CONFIG,
  LIVE_STATES,
  registryPath,
  relationsPath,
} from './paths.js';

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await rename(tmp, path);
  } catch {
    await copyFile(tmp, path);
    await rm(tmp, { force: true });
  }
}

async function walkJsonFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return acc;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkJsonFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.json')) acc.push(full);
  }
  return acc;
}

function emptyRegistry() {
  return { entries: [], aliases: [], vocabularies: [] };
}

export function createGitFileStore(supermemDir) {
  async function loadConfig() {
    const stored = await readJson(configPath(supermemDir), {});
    return { ...DEFAULT_CONFIG, ...stored, auto_admit: { ...DEFAULT_CONFIG.auto_admit, ...stored.auto_admit } };
  }

  async function saveConfig(config) {
    await writeJson(configPath(supermemDir), config);
    return config;
  }

  async function getAtom(idOrKey, projectId) {
    const key = String(idOrKey ?? '');
    if (key.includes('/')) {
      try {
        const live = await readJson(atomFilePath(supermemDir, key), null);
        if (live && (!projectId || live.project_id === projectId)) return live;
      } catch {
        return null;
      }
    }
    try {
      const archived = await readJson(archiveFilePath(supermemDir, key), null);
      if (archived && (!projectId || archived.project_id === projectId)) return archived;
    } catch {
      // invalid id — fall through to the live walk for UUID lookup
    }
    const atoms = await listAtoms({ projectId });
    return atoms.find(atom => atom.id === key || atom.topic_key === key) ?? null;
  }

  async function listAtoms({ projectId, lifecycleStates } = {}) {
    const files = [
      ...await walkJsonFiles(join(supermemDir, 'atoms')),
      ...await walkJsonFiles(join(supermemDir, 'archive')),
    ];
    const atoms = [];
    for (const file of files) {
      const atom = await readJson(file, null);
      if (!atom) continue;
      if (projectId && atom.project_id !== projectId) continue;
      if (lifecycleStates && !lifecycleStates.includes(atom.lifecycle_state)) continue;
      atoms.push(atom);
    }
    return atoms;
  }

  async function listByTopicLive(projectId, topicKey) {
    let live;
    try {
      live = await readJson(atomFilePath(supermemDir, topicKey), null);
    } catch {
      return [];
    }
    if (!live) return [];
    if (projectId && live.project_id !== projectId) return [];
    if (!['candidate', 'active'].includes(live.lifecycle_state)) return [];
    return [live];
  }

  async function putAtom(atom) {
    if (!atom?.id || !atom.project_id || !atom.topic_key) {
      throw new Error('atom_missing_identity');
    }
    const live = await listByTopicLive(atom.project_id, atom.topic_key);
    const conflict = live.find(existing => existing.id !== atom.id);
    if (conflict && ['candidate', 'active'].includes(atom.lifecycle_state)) {
      const err = new Error('live_topic_conflict');
      err.existing = conflict;
      throw err;
    }
    const now = new Date().toISOString();
    const stored = {
      ...atom,
      created_at: atom.created_at ?? now,
      updated_at: now,
      schema_version: atom.schema_version ?? 6,
    };
    const livePath = atomFilePath(supermemDir, stored.topic_key);
    const archivedPath = archiveFilePath(supermemDir, stored.id);
    if (ARCHIVE_STATES.includes(stored.lifecycle_state)) {
      await writeJson(archivedPath, stored);
      const live = await readJson(livePath, null);
      if (live?.id === stored.id) await rm(livePath, { force: true });
    } else {
      await writeJson(livePath, stored);
      await rm(archivedPath, { force: true });
    }
    return stored;
  }

  async function deleteAtom(atom) {
    await rm(atomFilePath(supermemDir, atom.topic_key), { force: true });
    await rm(archiveFilePath(supermemDir, atom.id), { force: true });
    return true;
  }

  async function loadRegistry() {
    return readJson(registryPath(supermemDir), emptyRegistry());
  }

  async function saveRegistry(registry) {
    await writeJson(registryPath(supermemDir), {
      entries: registry.entries ?? [],
      aliases: registry.aliases ?? [],
      vocabularies: registry.vocabularies ?? [],
    });
  }

  async function loadRelations() {
    return readJson(relationsPath(supermemDir), []);
  }

  async function saveRelations(relations) {
    await writeJson(relationsPath(supermemDir), relations);
  }

  return {
    supermemDir,
    loadConfig,
    saveConfig,
    getAtom,
    listAtoms,
    listByTopicLive,
    putAtom,
    deleteAtom,
    loadRegistry,
    saveRegistry,
    loadRelations,
    saveRelations,
  };
}
