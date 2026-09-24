import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { searchableTrigger } from '../engine/activation.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');
const parseAtom = payload => JSON.parse(payload);

function inParams(prefix, values) {
  const params = {};
  const sql = values.map((value, i) => {
    const key = `${prefix}${i}`;
    params[key] = value;
    return `@${key}`;
  }).join(',');
  return { sql, params };
}

function formContent(atom, type) {
  const forms = atom.retrieval_forms ?? {};
  if (typeof forms[type] === 'string') return forms[type];
  const listed = Array.isArray(forms) ? forms : [];
  return listed.find(form => form.form_type === type)?.content ?? '';
}

function atomColumns(atom) {
  return {
    id: atom.id,
    project_id: atom.project_id,
    memory_type: atom.memory_type,
    scope: atom.scope,
    title: atom.title,
    trigger: atom.trigger,
    behavior_delta: atom.behavior_delta,
    what: atom.what,
    why: atom.why,
    authority: atom.authority ?? 'observed',
    confidence: atom.confidence ?? 0.5,
    valid_from: atom.valid_from,
    valid_until: atom.valid_until ?? null,
    topic_key: atom.topic_key,
    tags: JSON.stringify(atom.tags ?? []),
    lifecycle_state: atom.lifecycle_state,
    schema_version: atom.schema_version,
    activation_count: atom.activation_count ?? 0,
    predominance: atom.predominance ?? 0,
    contested_at: atom.contested_at ?? null,
    superseded_by: atom.superseded_by ?? null,
    registry_key_id: atom.registry_key_id ?? null,
    payload: JSON.stringify(atom),
    created_at: atom.created_at,
    updated_at: atom.updated_at,
  };
}

export function createSqliteIndex(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA journal_mode = WAL');

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (err) { db.exec('ROLLBACK'); throw err; }
  }

  async function migrate() {
    // CREATE TABLE IF NOT EXISTS keeps an older CHECK on an existing table. An
    // index from before `legacy` is rebuilt in place with its rows (activation
    // counts live only here); its indexes are dropped first so the schema
    // recreates them on the new table rather than following the renamed one.
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_atoms'").get();
    const sql = await readFile(SCHEMA_PATH, 'utf8');
    if (existing && !existing.sql.includes("'legacy'")) {
      db.exec(`DROP INDEX IF EXISTS uq_memory_atoms_project_topic_effective;
        DROP INDEX IF EXISTS idx_memory_atoms_project_lifecycle;
        ALTER TABLE memory_atoms RENAME TO memory_atoms_before_legacy;`);
      db.exec(sql);
      db.exec('INSERT INTO memory_atoms SELECT * FROM memory_atoms_before_legacy; DROP TABLE memory_atoms_before_legacy;');
      return;
    }
    db.exec(sql);
  }

  function upsertAtom(atom) {
    const cols = atomColumns(atom);
    db.prepare(`
      INSERT INTO memory_atoms (
        id, project_id, memory_type, scope, title, trigger, behavior_delta, what, why,
        authority, confidence, valid_from, valid_until, topic_key, tags, lifecycle_state,
        schema_version, activation_count, predominance, contested_at, superseded_by,
        registry_key_id, payload, created_at, updated_at
      ) VALUES (
        @id, @project_id, @memory_type, @scope, @title, @trigger, @behavior_delta, @what, @why,
        @authority, @confidence, @valid_from, @valid_until, @topic_key, @tags, @lifecycle_state,
        @schema_version, @activation_count, @predominance, @contested_at, @superseded_by,
        @registry_key_id, @payload, @created_at, @updated_at
      )
      ON CONFLICT(id) DO UPDATE SET
        project_id=excluded.project_id,
        memory_type=excluded.memory_type,
        scope=excluded.scope,
        title=excluded.title,
        trigger=excluded.trigger,
        behavior_delta=excluded.behavior_delta,
        what=excluded.what,
        why=excluded.why,
        authority=excluded.authority,
        confidence=excluded.confidence,
        valid_from=excluded.valid_from,
        valid_until=excluded.valid_until,
        topic_key=excluded.topic_key,
        tags=excluded.tags,
        lifecycle_state=excluded.lifecycle_state,
        schema_version=excluded.schema_version,
        activation_count=excluded.activation_count,
        predominance=excluded.predominance,
        contested_at=excluded.contested_at,
        superseded_by=excluded.superseded_by,
        registry_key_id=excluded.registry_key_id,
        payload=excluded.payload,
        updated_at=excluded.updated_at
    `).run(cols);

    db.prepare('DELETE FROM memory_atoms_fts WHERE atom_id = ?').run(atom.id);
    db.prepare(`
      INSERT INTO memory_atoms_fts (atom_id, project_id, title, trigger, what, why, topic_key, micro, short)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      atom.id,
      atom.project_id,
      atom.title ?? '',
      searchableTrigger(atom),
      atom.what ?? '',
      atom.why ?? '',
      atom.topic_key ?? '',
      formContent(atom, 'micro'),
      formContent(atom, 'short'),
    );
  }

  function removeAtom(id) {
    db.prepare('DELETE FROM memory_atoms_fts WHERE atom_id = ?').run(id);
    db.prepare('DELETE FROM memory_atoms WHERE id = ?').run(id);
  }

  function getAtom(idOrKey, projectId) {
    const byId = db.prepare('SELECT payload FROM memory_atoms WHERE id = ?').get(idOrKey);
    if (byId) {
      const atom = parseAtom(byId.payload);
      if (!projectId || atom.project_id === projectId) return atom;
    }
    const row = projectId
      ? db.prepare("SELECT payload FROM memory_atoms WHERE topic_key = ? AND project_id = ? ORDER BY lifecycle_state IN ('active','contested') DESC, updated_at DESC LIMIT 1").get(idOrKey, projectId)
      : db.prepare("SELECT payload FROM memory_atoms WHERE topic_key = ? ORDER BY lifecycle_state IN ('active','contested') DESC, updated_at DESC LIMIT 1").get(idOrKey);
    return row ? parseAtom(row.payload) : null;
  }

  function listAtoms({ projectId, lifecycleStates, memoryTypes } = {}) {
    const clauses = [];
    const params = {};
    if (projectId) {
      clauses.push('project_id = @projectId');
      params.projectId = projectId;
    }
    if (lifecycleStates?.length) {
      clauses.push(`lifecycle_state IN (${lifecycleStates.map((_, i) => `@ls${i}`).join(',')})`);
      lifecycleStates.forEach((state, i) => { params[`ls${i}`] = state; });
    }
    if (memoryTypes?.length) {
      clauses.push(`memory_type IN (${memoryTypes.map((_, i) => `@mt${i}`).join(',')})`);
      memoryTypes.forEach((type, i) => { params[`mt${i}`] = type; });
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT payload FROM memory_atoms ${where} ORDER BY updated_at DESC`).all(params);
    return rows.map(row => parseAtom(row.payload));
  }

  function search({ projectId, query, limit = 50, lifecycleStates, memoryTypes } = {}) {
    if (!query?.trim()) return listAtoms({ projectId, lifecycleStates, memoryTypes }).slice(0, limit);
    const clauses = ['memory_atoms_fts MATCH @query', 'f.project_id = @projectId'];
    const params = { query, projectId, limit };
    if (lifecycleStates?.length) {
      clauses.push(`a.lifecycle_state IN (${lifecycleStates.map((_, i) => `@ls${i}`).join(',')})`);
      lifecycleStates.forEach((state, i) => { params[`ls${i}`] = state; });
    }
    if (memoryTypes?.length) {
      clauses.push(`a.memory_type IN (${memoryTypes.map((_, i) => `@mt${i}`).join(',')})`);
      memoryTypes.forEach((type, i) => { params[`mt${i}`] = type; });
    }
    const rows = db.prepare(`
      SELECT a.payload
      FROM memory_atoms_fts f
      JOIN memory_atoms a ON a.id = f.atom_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY bm25(memory_atoms_fts)
      LIMIT @limit
    `).all(params);
    return rows.map(row => parseAtom(row.payload));
  }

  function listByTopicLive(projectId, topicKey) {
    const rows = db.prepare(`
      SELECT payload FROM memory_atoms
      WHERE project_id = ? AND topic_key = ?
        AND lifecycle_state IN ('active', 'contested')
    `).all(projectId, topicKey);
    return rows.map(row => parseAtom(row.payload));
  }

  function countAtoms({ projectId, lifecycleStates, memoryTypes } = {}) {
    const clauses = [];
    const params = {};
    if (projectId) {
      clauses.push('project_id = @projectId');
      params.projectId = projectId;
    }
    if (lifecycleStates?.length) {
      const listed = inParams('ls', lifecycleStates);
      Object.assign(params, listed.params);
      clauses.push(`lifecycle_state IN (${listed.sql})`);
    }
    if (memoryTypes?.length) {
      const listed = inParams('mt', memoryTypes);
      Object.assign(params, listed.params);
      clauses.push(`memory_type IN (${listed.sql})`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`SELECT COUNT(*) AS n FROM memory_atoms ${where}`).get(params).n;
  }

  function countByLifecycle(projectId) {
    const rows = projectId
      ? db.prepare('SELECT lifecycle_state, COUNT(*) AS n FROM memory_atoms WHERE project_id = ? GROUP BY lifecycle_state').all(projectId)
      : db.prepare('SELECT lifecycle_state, COUNT(*) AS n FROM memory_atoms GROUP BY lifecycle_state').all();
    const counts = {};
    let total = 0;
    for (const row of rows) {
      counts[row.lifecycle_state] = row.n;
      total += row.n;
    }
    return { counts, total };
  }

  function loadHealthSnapshot(projectId) {
    const atoms = db.prepare(`
      SELECT id, topic_key, trigger, authority, lifecycle_state, activation_count, created_at, contested_at,
             json_extract(payload, '$.replaces') AS replaces
      FROM memory_atoms
      WHERE project_id = ?
    `).all(projectId);
    const events = db.prepare(`
      SELECT returned_atom_ids, created_at
      FROM memory_retrieval_events
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(projectId);
    const obs = db.prepare(`
      SELECT COUNT(*) AS n, MIN(observed_at) AS oldest
      FROM memory_observations
      WHERE project_id = ? AND promotion_status = 'unreviewed'
    `).get(projectId);
    return {
      project_id: projectId,
      atoms,
      retrieval_events: events.map(row => ({
        returned_atom_ids: JSON.parse(row.returned_atom_ids ?? '[]'),
        created_at: row.created_at,
      })),
      observations: {
        unreviewed: obs?.n ?? 0,
        oldest_at: obs?.oldest ?? null,
      },
    };
  }

  function listRelations({ atomIds } = {}) {
    if (atomIds) {
      if (!atomIds.length) return [];
      const listed = inParams('id', atomIds);
      return db.prepare(`
        SELECT id, source_atom_id, relation_type, target_atom_id, confidence, created_at
        FROM memory_relations
        WHERE source_atom_id IN (${listed.sql}) OR target_atom_id IN (${listed.sql})
      `).all(listed.params);
    }
    return db.prepare(`
      SELECT id, source_atom_id, relation_type, target_atom_id, confidence, created_at
      FROM memory_relations
    `).all();
  }

  function getVocabulary(projectId) {
    const vocabs = db.prepare(`
      SELECT kind, value FROM registry_vocabularies
      WHERE project_id = ? AND status != 'deprecated'
    `).all(projectId);
    return {
      domains: vocabs.filter(row => row.kind === 'domain').map(row => row.value),
      tags: vocabs.filter(row => row.kind === 'tag').map(row => row.value),
    };
  }

  function getVocabularyValue(projectId, kind, value) {
    return db.prepare(`
      SELECT id, project_id, kind, value, status, created_at
      FROM registry_vocabularies
      WHERE project_id = ? AND kind = ? AND value = ?
    `).get(projectId, kind, value) ?? null;
  }

  function getRegistryEntryByKey(projectId, key) {
    return db.prepare(`
      SELECT id, project_id, canonical_key, status, notes, created_at, updated_at
      FROM topic_registry
      WHERE project_id = ? AND canonical_key = ?
    `).get(projectId, key) ?? null;
  }

  function getRegistryEntryById(id) {
    return db.prepare(`
      SELECT id, project_id, canonical_key, status, notes, created_at, updated_at
      FROM topic_registry WHERE id = ?
    `).get(id) ?? null;
  }

  function getAliasByName(projectId, alias) {
    return db.prepare(`
      SELECT id, registry_id, project_id, alias, kind, lang, created_at
      FROM topic_aliases
      WHERE project_id = ? AND alias = ?
    `).get(projectId, alias) ?? null;
  }

  function getAliasesForRegistry(registryId) {
    return db.prepare(`
      SELECT id, registry_id, project_id, alias, kind, lang, created_at
      FROM topic_aliases WHERE registry_id = ?
    `).all(registryId);
  }

  function getAliasesForRegistryIds(ids = []) {
    if (!ids.length) return [];
    const listed = inParams('id', ids);
    return db.prepare(`
      SELECT id, registry_id, project_id, alias, kind, lang, created_at
      FROM topic_aliases WHERE registry_id IN (${listed.sql})
    `).all(listed.params);
  }

  function findAliasOccurrences(projectId, normalizedText) {
    const rows = db.prepare(`
      SELECT a.alias AS alias, a.registry_id AS registry_id, e.canonical_key AS canonical_key
      FROM topic_aliases a
      JOIN topic_registry e ON e.id = a.registry_id
      WHERE a.project_id = ?
    `).all(projectId);
    return rows.filter(row => normalizedText.includes(row.alias));
  }

  function incrementActivation(ids = []) {
    const select = db.prepare('SELECT payload FROM memory_atoms WHERE id = ?');
    const update = db.prepare(`
      UPDATE memory_atoms
      SET activation_count = @activation_count, payload = @payload
      WHERE id = @id
    `);
    for (const id of ids) {
      const row = select.get(id);
      if (!row) continue;
      const atom = JSON.parse(row.payload);
      atom.activation_count = (atom.activation_count ?? 0) + 1;
      update.run({
        id,
        activation_count: atom.activation_count,
        payload: JSON.stringify(atom),
      });
    }
  }

  function rebuild(atoms, registry, relations) {
    const prior = db.prepare('SELECT id, activation_count FROM memory_atoms').all();
    const counts = new Map(prior.map(row => [row.id, row.activation_count]));
    db.exec(`
      DELETE FROM memory_atoms_fts;
      DELETE FROM memory_relations;
      DELETE FROM topic_aliases;
      DELETE FROM registry_vocabularies;
      DELETE FROM topic_registry;
      DELETE FROM memory_atoms;
    `);
    for (const atom of atoms) {
      const preserved = counts.get(atom.id);
      if (preserved != null) {
        atom.activation_count = Math.max(atom.activation_count ?? 0, preserved);
      }
      upsertAtom(atom);
    }
    for (const entry of registry.entries ?? []) {
      db.prepare(`
        INSERT INTO topic_registry (id, project_id, canonical_key, status, notes, created_at, updated_at)
        VALUES (@id, @project_id, @canonical_key, @status, @notes, @created_at, @updated_at)
      `).run({
        notes: null,
        ...entry,
      });
    }
    for (const alias of registry.aliases ?? []) {
      db.prepare(`
        INSERT INTO topic_aliases (id, registry_id, project_id, alias, kind, lang, created_at)
        VALUES (@id, @registry_id, @project_id, @alias, @kind, @lang, @created_at)
      `).run({ lang: null, kind: 'alias', ...alias });
    }
    for (const vocab of registry.vocabularies ?? []) {
      db.prepare(`
        INSERT INTO registry_vocabularies (id, project_id, kind, value, status, created_at)
        VALUES (@id, @project_id, @kind, @value, @status, @created_at)
      `).run({ status: 'active', ...vocab });
    }
    for (const rel of relations ?? []) {
      db.prepare(`
        INSERT INTO memory_relations (id, source_atom_id, relation_type, target_atom_id, confidence, created_at)
        VALUES (@id, @source_atom_id, @relation_type, @target_atom_id, @confidence, @created_at)
      `).run({ confidence: 0.5, ...rel });
    }
  }

  function getMeta(key) {
    const row = db.prepare('SELECT value FROM index_meta WHERE key = ?').get(key);
    return row?.value ?? null;
  }

  function setMeta(key, value) {
    db.prepare(`
      INSERT INTO index_meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
  }

  function getEvidenceFreshness(atomId, sourceRef) {
    const row = db.prepare('SELECT mtime_ms, size, hash FROM evidence_freshness_cache WHERE atom_id = ? AND source_ref = ?').get(atomId, sourceRef);
    return row ? { mtimeMs: row.mtime_ms, size: row.size, hash: row.hash } : null;
  }

  function setEvidenceFreshness(atomId, sourceRef, { mtimeMs, size, hash }) {
    db.prepare(`
      INSERT INTO evidence_freshness_cache (atom_id, source_ref, mtime_ms, size, hash, checked_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(atom_id, source_ref) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size, hash = excluded.hash, checked_at = excluded.checked_at
    `).run(atomId, sourceRef, mtimeMs, size, hash, new Date().toISOString());
  }

  function close() {
    db.close();
  }

  return {
    db,
    migrate,
    upsertAtom,
    removeAtom,
    getAtom,
    listAtoms,
    listByTopicLive,
    search,
    countAtoms,
    countByLifecycle,
    loadHealthSnapshot,
    listRelations,
    getVocabulary,
    getVocabularyValue,
    getRegistryEntryByKey,
    getRegistryEntryById,
    getAliasByName,
    getAliasesForRegistry,
    getAliasesForRegistryIds,
    findAliasOccurrences,
    incrementActivation,
    getMeta,
    setMeta,
    getEvidenceFreshness,
    setEvidenceFreshness,
    rebuild: (atoms, registry, relations) => transaction(() => rebuild(atoms, registry, relations)),
    transaction,
    close,
  };
}
