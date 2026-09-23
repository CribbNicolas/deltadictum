import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ARCHIVE_STATES, archiveFilePath, atomFilePath, candidateFilePath, configPath,
  DEFAULT_CONFIG, registryPath, relationsPath } from './paths.js';
import { commitTransaction, createWriteLock, readJson, recoverTransaction, writeJson } from './transactions.js';
import { SCHEMA_VERSION, unsupportedReason } from '../engine/contract.js';

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
  // `.dd/config.json` does not change mid-process outside of `saveConfig`/`recover`,
  // both of which clear this. Memoizing avoids re-reading and re-merging it on every
  // call: retrieval, telemetry pruning and project bootstrap all call loadConfig once
  // per hook invocation today, which meant one hook could hit disk for it 3+ times.
  let configCache = null;
  const effective = atom => ['active', 'contested'].includes(atom.lifecycle_state);
  const rel = path => relative(ddDir, path).replaceAll('\\', '/');
  function destination(atom) {
    if (atom.lifecycle_state === 'candidate') return candidateFilePath(ddDir, atom.id);
    if (ARCHIVE_STATES.includes(atom.lifecycle_state)) return archiveFilePath(ddDir, atom.id);
    return atomFilePath(ddDir, atom.topic_key);
  }

  // Every knowledge file with the reason it cannot be read, or null when it can.
  // A file that is not valid JSON is reported like any other unsupported atom
  // rather than failing the whole read (L5).
  async function readStored() {
    const files = (await Promise.all(['atoms', 'candidates', 'archive'].map(dir => walk(join(ddDir, dir))))).flat();
    return Promise.all(files.map(async file => {
      try {
        const atom = await readJson(file, null);
        return { file, atom, reason: atom ? unsupportedReason(atom) : null };
      } catch { return { file, atom: null, reason: 'invalid_json' }; }
    }));
  }

  async function listAtoms({ projectId, lifecycleStates, memoryTypes } = {}) {
    return (await readStored()).filter(({ atom, reason }) => atom && !reason).map(({ atom }) => atom)
      .filter(atom => (!projectId || atom.project_id === projectId)
        && (!lifecycleStates || lifecycleStates.includes(atom.lifecycle_state))
        && (!memoryTypes || memoryTypes.includes(atom.memory_type)));
  }

  // Files this build refuses to read. They are never indexed or recalled; the
  // health report names them so a person can fix or delete them.
  async function listUnsupported() {
    return (await readStored()).filter(({ reason }) => reason)
      .map(({ file, atom, reason }) => ({ path: rel(file), id: atom?.id ?? null, topic_key: atom?.topic_key ?? null, reason }));
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
        const next = { ...atom, created_at: atom.created_at ?? now, updated_at: now, schema_version: SCHEMA_VERSION };
        const reason = unsupportedReason(next);
        if (reason) throw new Error(`atom_unsupported:${reason}`);
        return next;
      });
      const destinations = new Set();
      for (const atom of stored) {
        const target = destination(atom);
        if (destinations.has(target)) throw new Error('live_topic_conflict');
        destinations.add(target);
        if (effective(atom)) {
          const current = await readJson(atomFilePath(ddDir, atom.topic_key), null);
          // An unreadable file holds the topic until a person fixes or deletes it.
          if (current && unsupportedReason(current)) throw new Error('live_topic_unsupported');
          const replaced = stored.find(next => next.id === current?.id && !effective(next));
          if (current && current.id !== atom.id && effective(current) && !replaced
              && !deleteAtoms.some(old => old.id === current.id)) throw new Error('live_topic_conflict');
        }
      }
      // Remove only files that belong to this identity, wherever its state placed them.
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
    if (configCache) return configCache;
    const stored = await readJson(configPath(ddDir), {});
    return configCache = Object.fromEntries(Object.entries({ ...DEFAULT_CONFIG, ...stored }).map(([key, value]) =>
      [key, value && typeof value === 'object' && !Array.isArray(value) ? { ...DEFAULT_CONFIG[key], ...value } : value]));
  }

  return {
    ddDir, withWriteLock, commit, listAtoms, listUnsupported, loadConfig,
    // An out-of-band edit to config.json (another process, a person editing it by
    // hand) must still be picked up here, same as it would be for any other file
    // under ddDir, so recover() clears the memo along with everything else it recovers.
    recover: () => withWriteLock(async () => { configCache = null; return recoverTransaction(ddDir); }),
    saveConfig: config => withWriteLock(async () => { await writeJson(configPath(ddDir), config); configCache = null; return config; }),
    putAtom: async atom => (await commit({ atoms: [atom] }))[0],
    deleteAtom: async atom => { await commit({ deleteAtoms: [atom] }); return true; },
    loadRegistry: () => readJson(registryPath(ddDir), { entries: [], aliases: [], vocabularies: [] }),
    saveRegistry: registry => withWriteLock(() => writeJson(registryPath(ddDir), registry)),
    loadRelations: () => readJson(relationsPath(ddDir), []),
    saveRelations: relations => withWriteLock(() => writeJson(relationsPath(ddDir), relations)),
  };
}
