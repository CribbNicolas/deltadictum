import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ARCHIVE_STATES, archiveFilePath, atomFilePath, candidateFilePath, configPath,
  DEFAULT_CONFIG, registryPath, relationsPath } from './paths.js';
import { commitTransaction, createWriteLock, readJson, recoverTransaction, writeJson } from './transactions.js';

async function walk(dir) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  const nested = await Promise.all(entries.map(entry => entry.isDirectory() ? walk(join(dir, entry.name))
    : entry.isFile() && entry.name.endsWith('.json') ? [join(dir, entry.name)] : []));
  return nested.flat();
}

export function createGitFileStore(ddDir) {
  const withWriteLock = createWriteLock(ddDir);
  const effective = atom => ['active', 'contested'].includes(atom.lifecycle_state);
  const rel = path => relative(ddDir, path).replaceAll('\\', '/');
  function destination(atom) {
    if (atom.lifecycle_state === 'candidate') return candidateFilePath(ddDir, atom.id);
    if (ARCHIVE_STATES.includes(atom.lifecycle_state)) return archiveFilePath(ddDir, atom.id);
    return atomFilePath(ddDir, atom.topic_key);
  }

  async function listAtoms({ projectId, lifecycleStates, memoryTypes } = {}) {
    const files = (await Promise.all(['atoms', 'candidates', 'archive'].map(dir => walk(join(ddDir, dir))))).flat();
    const atoms = await Promise.all(files.map(file => readJson(file, null)));
    return atoms.filter(atom => atom && (!projectId || atom.project_id === projectId)
      && (!lifecycleStates || lifecycleStates.includes(atom.lifecycle_state))
      && (!memoryTypes || memoryTypes.includes(atom.memory_type)));
  }

  async function getAtom(idOrKey, projectId) {
    const key = String(idOrKey ?? '');
    const paths = key.includes('/') ? [atomFilePath(ddDir, key)]
      : [candidateFilePath(ddDir, key), archiveFilePath(ddDir, key)];
    for (const path of paths) {
      const atom = await readJson(path, null);
      if (atom && (!projectId || atom.project_id === projectId)) return atom;
    }
    const atoms = await listAtoms({ projectId });
    return atoms.find(atom => atom.id === key)
      ?? atoms.filter(atom => atom.topic_key === key).sort((a, b) => Number(effective(b)) - Number(effective(a)))[0] ?? null;
  }

  async function listByTopicLive(projectId, topicKey) {
    const atom = await readJson(atomFilePath(ddDir, topicKey), null);
    return atom && atom.project_id === projectId && effective(atom) ? [atom] : [];
  }

  async function commit({ atoms = [], deleteAtoms = [], relations } = {}) {
    return withWriteLock(async () => {
      await recoverTransaction(ddDir);
      const operations = new Map();
      const now = new Date().toISOString();
      const stored = atoms.map(atom => {
        if (!atom?.id || !atom.project_id || !atom.topic_key) throw new Error('atom_missing_identity');
        atomFilePath(ddDir, atom.topic_key);
        archiveFilePath(ddDir, atom.id);
        return { ...atom, created_at: atom.created_at ?? now, updated_at: now, schema_version: atom.schema_version ?? 6 };
      });
      const destinations = new Set();
      for (const atom of stored) {
        const target = destination(atom);
        if (destinations.has(target)) throw new Error('live_topic_conflict');
        destinations.add(target);
        if (effective(atom)) {
          const current = await readJson(atomFilePath(ddDir, atom.topic_key), null);
          const replaced = stored.find(next => next.id === current?.id && !effective(next));
          if (current && current.id !== atom.id && effective(current) && !replaced
              && !deleteAtoms.some(old => old.id === current.id)) throw new Error('live_topic_conflict');
        }
      }
      // Remove only files that belong to this identity, including legacy candidates.
      for (const atom of [...stored, ...deleteAtoms]) {
        for (const path of [atomFilePath(ddDir, atom.topic_key), candidateFilePath(ddDir, atom.id), archiveFilePath(ddDir, atom.id)]) {
          const previous = await readJson(path, null);
          if (previous?.id === atom.id && previous.project_id === atom.project_id) operations.set(rel(path), null);
        }
      }
      for (const atom of stored) operations.set(rel(destination(atom)), atom);
      if (relations !== undefined) operations.set('relations.json', relations);
      await commitTransaction(ddDir, [...operations].map(([path, value]) => ({ path, value })));
      return stored;
    });
  }

  async function loadConfig() {
    const stored = await readJson(configPath(ddDir), {});
    return Object.fromEntries(Object.entries({ ...DEFAULT_CONFIG, ...stored }).map(([key, value]) =>
      [key, value && typeof value === 'object' && !Array.isArray(value) ? { ...DEFAULT_CONFIG[key], ...value } : value]));
  }

  return {
    ddDir, withWriteLock, commit, getAtom, listAtoms, listByTopicLive, loadConfig,
    recover: () => withWriteLock(() => recoverTransaction(ddDir)),
    saveConfig: config => withWriteLock(async () => { await writeJson(configPath(ddDir), config); return config; }),
    putAtom: async atom => (await commit({ atoms: [atom] }))[0],
    deleteAtom: async atom => { await commit({ deleteAtoms: [atom] }); return true; },
    loadRegistry: () => readJson(registryPath(ddDir), { entries: [], aliases: [], vocabularies: [] }),
    saveRegistry: registry => withWriteLock(() => writeJson(registryPath(ddDir), registry)),
    loadRelations: () => readJson(relationsPath(ddDir), []),
    saveRelations: relations => withWriteLock(() => writeJson(relationsPath(ddDir), relations)),
  };
}
