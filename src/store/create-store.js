import { mkdir, writeFile } from 'node:fs/promises';
import { watch } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createGitFileStore } from './git-file-store.js';
import { sqlitePath } from './paths.js';
import { createSqliteIndex } from './sqlite-index.js';
import { sourceFingerprint } from './fingerprint.js';
import { assessDeterioration, healthThresholdsFromConfig } from '../engine/health/deterioration.js';
import { createTelemetry } from './telemetry.js';

function nowIso() {
  return new Date().toISOString();
}

// Bumped whenever what the index may hold changes, so an index built by an
// earlier build is rebuilt from git. 7.2: atoms outside the stored contract
// (src/engine/contract.js) are no longer indexed.
const INDEX_FORMAT = '7.2';

export async function createMemoryStore({ ddDir, dataDir, repoRoot = dirname(ddDir) }) {
  // Local telemetry holds prompts and command output: private to its owner (POSIX).
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await mkdir(ddDir, { recursive: true });
  // Knowledge is shareable; process capabilities and telemetry are local.
  // Exclusive creation preserves an existing project's ignore policy.
  try {
    await writeFile(join(ddDir, '.gitignore'), '.write-lock\n.pending-write.json\n*.tmp\n*.sqlite\n*.sqlite-*\nobservations/\n', { flag: 'wx' });
  } catch (err) { if (err.code !== 'EEXIST') throw err; }

  const git = createGitFileStore(ddDir);
  const index = createSqliteIndex(sqlitePath(dataDir));
  await index.migrate();

  async function reindex() {
    const [atoms, registry, relations] = await Promise.all([
      git.listAtoms(),
      git.loadRegistry(),
      git.loadRelations(),
    ]);
    index.rebuild(atoms, registry, relations);
    index.setMeta('source_fingerprint', await sourceFingerprint(ddDir));
    index.setMeta('index_format', INDEX_FORMAT);
    return { atoms: atoms.length };
  }

  async function refreshFingerprint() {
    index.setMeta('source_fingerprint', await sourceFingerprint(ddDir));
  }

  async function refresh() {
    await git.recover();
    if (index.getMeta('index_format') !== INDEX_FORMAT || index.getMeta('source_fingerprint') !== await sourceFingerprint(ddDir)) await reindex();
  }

  await git.withWriteLock(refresh);
  const telemetry = createTelemetry(index, git);
  await telemetry.prune();
  let dirty = false;
  let refreshedAt = Date.now();
  let watcher;
  // Local-only observer set (INV: nothing here mutates state, it only tells an
  // already-persistent caller — the audit UI's own HTTP server — that something
  // did). Never required: a hook or the MCP server never subscribes, since both
  // are ephemeral or headless and have nobody to push to.
  const changeListeners = new Set();
  function notifyChange() { for (const fn of changeListeners) { try { fn(); } catch { /* a bad listener must not break the write path */ } } }
  try {
    watcher = watch(ddDir, { recursive: true }, (_event, file) => {
      if (/^(atoms|archive|candidates|registry)([\\/]|$)|^relations\.json$/.test(String(file))) { dirty = true; notifyChange(); }
    });
    watcher.on('error', () => { dirty = true; });
  } catch { /* Periodic freshness checks cover platforms without recursive watch. */ }
  async function refreshIfChanged() {
    if (!dirty && Date.now() - refreshedAt < 5000) return;
    await git.withWriteLock(refresh);
    dirty = false; refreshedAt = Date.now();
  }

  async function withWriteLock(work) {
    return git.withWriteLock(async () => { await refresh(); const result = await work(); notifyChange(); return result; });
  }

  async function commitAtoms(atoms, newRelations = [], deleteAtoms = []) {
    return withWriteLock(async () => {
      for (const atom of atoms) {
        const previous = index.getAtom(atom.id);
        if (previous && (previous.project_id !== atom.project_id || previous.topic_key !== atom.topic_key)) throw new Error('immutable_memory_identity');
      }
      const relations = await git.loadRelations();
      for (const relation of newRelations) {
        if (!relations.some(r => r.source_atom_id === relation.source_atom_id && r.target_atom_id === relation.target_atom_id && r.relation_type === relation.relation_type)) {
          relations.push({ id: randomUUID(), confidence: 0.5, created_at: nowIso(), ...relation });
        }
      }
      const deleted = new Set(deleteAtoms.map(atom => atom.id));
      const kept = relations.filter(r => !deleted.has(r.source_atom_id) && !deleted.has(r.target_atom_id));
      const stored = await git.commit({ atoms, deleteAtoms, relations: kept });
      // Index updates are atomic; on failure the Git journal/source wins on reopen.
      if (newRelations.length || deleteAtoms.length) await reindex();
      else {
        index.transaction(() => {
          for (const atom of stored.filter(a => !['active', 'contested'].includes(a.lifecycle_state))) index.upsertAtom(atom);
          for (const atom of stored.filter(a => ['active', 'contested'].includes(a.lifecycle_state))) index.upsertAtom(atom);
        });
        await refreshFingerprint();
      }
      return stored;
    });
  }

  async function putAtom(atom) {
    return (await commitAtoms([atom]))[0];
  }

  async function deleteAtom(atom) {
    await commitAtoms([], [], [atom]);
    return true;
  }

  async function logAdmission(entry) {
    index.db.prepare(`
      INSERT INTO memory_admission_decisions (id, project_id, decision, reasons, score, atom_id, observation_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      entry.project_id ?? null,
      entry.decision,
      JSON.stringify(entry.reasons ?? []),
      entry.score ?? null,
      entry.atom_id ?? null,
      entry.observation_id ?? null,
      nowIso(),
    );
    await telemetry.prune();
  }

  // Admission decisions were write-only until measurement needed them.
  // Only proposeMemory outcomes are write attempts; 'admit' is a later review event.
  async function listAdmissions({ projectId } = {}) {
    const rows = projectId
      ? index.db.prepare('SELECT decision, reasons, atom_id, created_at FROM memory_admission_decisions WHERE project_id = ? ORDER BY created_at').all(projectId)
      : index.db.prepare('SELECT decision, reasons, atom_id, created_at FROM memory_admission_decisions ORDER BY created_at').all();
    return rows.map(row => ({ ...row, reasons: JSON.parse(row.reasons) }));
  }

  async function logContradiction(entry) {
    index.db.prepare(`
      INSERT INTO memory_contradiction_log (
        id, project_id, atom_a_id, atom_b_id, detection_source, action, winner_atom_id, actor_ref, reasons, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      entry.project_id,
      entry.atom_a_id,
      entry.atom_b_id ?? null,
      entry.detection_source,
      entry.action,
      entry.winner_atom_id ?? null,
      entry.actor_ref ?? null,
      JSON.stringify(entry.reasons ?? []),
      nowIso(),
    );
  }

  async function incrementActivation(ids = []) {
    index.incrementActivation(ids);
  }

  async function logRetrieval(entry) {
    index.db.prepare(`
      INSERT INTO memory_retrieval_events (
        id, project_id, query, action, intent, returned_atom_ids, abstained, value_per_token, budget_used, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      entry.project_id,
      entry.query ?? null,
      entry.action ?? null,
      entry.intent ?? null,
      JSON.stringify(entry.returned_atom_ids ?? []),
      entry.abstained ? 1 : 0,
      entry.value_per_token ?? null,
      entry.budget_used ?? 0,
      nowIso(),
    );
    await telemetry.prune();
  }

  async function getVocabulary(projectId) {
    return index.getVocabulary(projectId);
  }

  async function getVocabularyValue(projectId, kind, value) {
    return index.getVocabularyValue(projectId, kind, value);
  }

  async function getRegistryEntryByKey(projectId, key) {
    return index.getRegistryEntryByKey(projectId, key);
  }

  async function getAliasByName(projectId, alias) {
    return index.getAliasByName(projectId, alias);
  }

  async function getRegistryEntryById(id) {
    return index.getRegistryEntryById(id);
  }

  async function getAliasesForRegistry(registryId) {
    return index.getAliasesForRegistry(registryId);
  }

  async function getAliasesForRegistryIds(ids) {
    return index.getAliasesForRegistryIds(ids);
  }

  async function findAliasOccurrences(projectId, normalizedText) {
    return index.findAliasOccurrences(projectId, normalizedText);
  }

  async function persistRegistry(mutator) {
    return withWriteLock(async () => {
    const registry = await git.loadRegistry();
    const result = await mutator(registry);
    await git.saveRegistry(registry);
    await reindex();
    return result;
    });
  }

  async function createRegistryEntry(projectId, key, status) {
    return persistRegistry(registry => {
      const entry = {
        id: randomUUID(),
        project_id: projectId,
        canonical_key: key,
        status,
        notes: null,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      registry.entries.push(entry);
      return entry;
    });
  }

  async function createAlias(registryId, projectId, alias, kind, lang) {
    return persistRegistry(registry => {
      const row = {
        id: randomUUID(),
        registry_id: registryId,
        project_id: projectId,
        alias,
        kind: kind ?? 'alias',
        lang: lang ?? null,
        created_at: nowIso(),
      };
      registry.aliases.push(row);
      return row;
    });
  }

  async function createVocabularyValue(projectId, kind, value) {
    return persistRegistry(registry => {
      const row = {
        id: randomUUID(),
        project_id: projectId,
        kind,
        value,
        status: 'active',
        created_at: nowIso(),
      };
      registry.vocabularies.push(row);
      return row;
    });
  }

  async function updateRegistryStatus(projectId, key, status) {
    return persistRegistry(registry => {
      const entry = registry.entries.find(e => e.project_id === projectId && e.canonical_key === key);
      if (!entry) return null;
      entry.status = status;
      entry.updated_at = nowIso();
      return entry;
    });
  }

  async function renameRegistryEntry(id, newKey) {
    return persistRegistry(registry => {
      const entry = registry.entries.find(e => e.id === id);
      if (!entry) return null;
      entry.canonical_key = newKey;
      entry.updated_at = nowIso();
      return entry;
    });
  }

  async function listRelations(opts = {}) {
    return index.listRelations(opts);
  }

  async function putRelation(relation) {
    return withWriteLock(async () => {
    const relations = await git.loadRelations();
    const row = {
      id: relation.id ?? randomUUID(),
      confidence: 0.5,
      created_at: nowIso(),
      ...relation,
    };
    const idx = relations.findIndex(r =>
      r.source_atom_id === row.source_atom_id &&
      r.relation_type === row.relation_type &&
      r.target_atom_id === row.target_atom_id,
    );
    if (idx >= 0) relations[idx] = { ...relations[idx], ...row };
    else relations.push(row);
    await git.saveRelations(relations);
    await reindex();
    return row;
    });
  }

  return {
    git,
    ddDir, dataDir, repoRoot,
    withWriteLock, commitAtoms, refreshIfChanged, refresh: () => git.withWriteLock(refresh),
    index,
    reindex: () => git.withWriteLock(async () => { await git.recover(); return reindex(); }),
    loadConfig: () => git.loadConfig(),
    saveConfig: config => git.saveConfig(config),
    getAtom: async (id, projectId) => index.getAtom(id, projectId),
    listAtoms: opts => Promise.resolve(index.listAtoms(opts)),
    listByTopicLive: (projectId, topicKey) => Promise.resolve(index.listByTopicLive(projectId, topicKey)),
    search: opts => Promise.resolve(index.search(opts)),
    countAtoms: opts => Promise.resolve(index.countAtoms(opts)),
    countByLifecycle: projectId => Promise.resolve(index.countByLifecycle(projectId)),
    loadHealthSnapshot: projectId => Promise.resolve(index.loadHealthSnapshot(projectId)),
    assessDeterioration: async (projectId, { now } = {}) => {
      const snapshot = { ...index.loadHealthSnapshot(projectId), unsupported: await git.listUnsupported() };
      const config = await git.loadConfig();
      return assessDeterioration(snapshot, now ?? nowIso(), healthThresholdsFromConfig(config));
    },
    listUnsupported: () => git.listUnsupported(),
    putAtom,
    deleteAtom,
    logAdmission,
    listAdmissions,
    logRetrieval,
    logContradiction,
    incrementActivation,
    getVocabulary,
    getVocabularyValue,
    getRegistryEntryByKey,
    getAliasByName,
    getRegistryEntryById,
    getAliasesForRegistry,
    getAliasesForRegistryIds,
    findAliasOccurrences,
    createRegistryEntry,
    createAlias,
    createVocabularyValue,
    updateRegistryStatus,
    renameRegistryEntry,
    listRelations,
    putRelation,
    onChange: fn => { changeListeners.add(fn); return () => changeListeners.delete(fn); },
    close: () => { watcher?.close(); changeListeners.clear(); index.close(); },
    ...telemetry,
  };
}
