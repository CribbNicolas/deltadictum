-- DD local index schema.
-- Source of truth is git files; this database is a local index.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS memory_atoms (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('claim','decision','lesson','anti_memory','procedure')),
  scope TEXT NOT NULL CHECK (scope IN ('project','user','agent','workflow','file','service')),
  title TEXT NOT NULL CHECK (length(title) > 0),
  trigger TEXT NOT NULL CHECK (length(trigger) > 0),
  behavior_delta TEXT NOT NULL CHECK (length(behavior_delta) > 0),
  what TEXT NOT NULL CHECK (length(what) > 0),
  why TEXT NOT NULL CHECK (length(why) > 0),
  authority TEXT NOT NULL DEFAULT 'observed' CHECK (authority IN ('observed','inferred','validated','canonical','deprecated')),
  confidence REAL NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  valid_from TEXT NOT NULL,
  valid_until TEXT,
  topic_key TEXT NOT NULL CHECK (length(topic_key) > 0),
  tags TEXT NOT NULL DEFAULT '[]',
  lifecycle_state TEXT NOT NULL DEFAULT 'candidate' CHECK (lifecycle_state IN ('candidate','active','contested','superseded','archived','rejected','legacy')),
  schema_version INTEGER NOT NULL DEFAULT 7,
  activation_count INTEGER NOT NULL DEFAULT 0,
  predominance REAL NOT NULL DEFAULT 0 CHECK (predominance >= 0),
  contested_at TEXT,
  superseded_by TEXT,
  registry_key_id TEXT,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DROP INDEX IF EXISTS uq_memory_atoms_project_topic_live;
CREATE UNIQUE INDEX IF NOT EXISTS uq_memory_atoms_project_topic_effective
  ON memory_atoms(project_id, topic_key)
  WHERE lifecycle_state IN ('active','contested');

CREATE INDEX IF NOT EXISTS idx_memory_atoms_project_lifecycle
  ON memory_atoms(project_id, lifecycle_state, memory_type, updated_at);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_atoms_fts USING fts5(
  atom_id UNINDEXED,
  project_id UNINDEXED,
  title,
  trigger,
  what,
  why,
  topic_key,
  micro,
  short
);

CREATE TABLE IF NOT EXISTS memory_observations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  raw_preview TEXT NOT NULL CHECK (length(raw_preview) BETWEEN 1 AND 4000),
  observed_at TEXT NOT NULL,
  promotion_status TEXT NOT NULL DEFAULT 'unreviewed',
  sanitization_status TEXT NOT NULL DEFAULT 'sanitized',
  metadata TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS topic_registry (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisional' CHECK (status IN ('provisional','canonical','deprecated')),
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, canonical_key)
);

CREATE TABLE IF NOT EXISTS topic_aliases (
  id TEXT PRIMARY KEY,
  registry_id TEXT NOT NULL REFERENCES topic_registry(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'alias' CHECK (kind IN ('alias','rename','translation')),
  lang TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, alias)
);

CREATE TABLE IF NOT EXISTS registry_vocabularies (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('domain','tag')),
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deprecated')),
  created_at TEXT NOT NULL,
  UNIQUE (project_id, kind, value)
);

CREATE TABLE IF NOT EXISTS memory_relations (
  id TEXT PRIMARY KEY,
  source_atom_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK (relation_type IN ('supports','contradicts','supersedes','derived_from','blocks','related_to')),
  target_atom_id TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  created_at TEXT NOT NULL,
  UNIQUE (source_atom_id, relation_type, target_atom_id)
);

CREATE TABLE IF NOT EXISTS memory_admission_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  decision TEXT NOT NULL,
  reasons TEXT NOT NULL DEFAULT '[]',
  score REAL,
  atom_id TEXT,
  observation_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_retrieval_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  query TEXT,
  action TEXT,
  intent TEXT,
  returned_atom_ids TEXT NOT NULL DEFAULT '[]',
  abstained INTEGER NOT NULL DEFAULT 0,
  value_per_token REAL,
  budget_used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Derived-only: a hash keyed by (atom_id, source_ref) plus the mtime/size it was
-- computed from, so checkEvidenceFreshness can skip a re-read+re-hash when the
-- file's mtime and size are unchanged. Never written into an atom's own
-- evidence_state/git file (that would be cache bookkeeping in git-authoritative
-- content); a stale or missing row here just costs one full re-hash, never a
-- wrong answer, so it needs no place in rebuild().
CREATE TABLE IF NOT EXISTS evidence_freshness_cache (
  atom_id TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (atom_id, source_ref)
);

CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  atom_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('helped','failed','refuted','not_applicable')),
  summary TEXT NOT NULL,
  evidence TEXT NOT NULL,
  verification TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, atom_id, task_id)
);
CREATE INDEX IF NOT EXISTS idx_feedback_project_atom ON memory_feedback(project_id, atom_id, created_at);

CREATE TABLE IF NOT EXISTS session_deliveries (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  atom_id TEXT NOT NULL,
  revision TEXT NOT NULL,
  delivered_at TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id, atom_id)
);
-- Capture once kept a per-session proposal quota; nothing reads it any more.
DROP TABLE IF EXISTS capture_sessions;

-- Automatic reminders have independent turn state; explicit proposals do not touch it.
CREATE TABLE IF NOT EXISTS capture_prompts (
  project_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  stopped INTEGER NOT NULL DEFAULT 0,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, session_id)
);

CREATE TABLE IF NOT EXISTS memory_contradiction_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  atom_a_id TEXT NOT NULL,
  atom_b_id TEXT,
  detection_source TEXT NOT NULL CHECK (detection_source IN ('same_key_supersede','explicit','worker_llm')),
  action TEXT NOT NULL CHECK (action IN ('contested','superseded','resolved')),
  winner_atom_id TEXT,
  actor_ref TEXT,
  reasons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

-- Embedding vectors for the resident process (L2/L3). Derived, like the rest of
-- the index: keyed by model and by a hash of the embedded text, so an edited
-- memory or a new model is re-embedded and nothing needs migrating.
CREATE TABLE IF NOT EXISTS memory_vectors (
  atom_id TEXT NOT NULL,
  model TEXT NOT NULL,
  text_hash TEXT NOT NULL,
  vector BLOB NOT NULL,
  PRIMARY KEY(atom_id, model)
);

-- Applied, rejected, revised and stale actions (src/engine/actions.js), kept as audit.
CREATE TABLE IF NOT EXISTS memory_action_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  targets TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','rejected','revised','stale')),
  note TEXT,
  actor_ref TEXT,
  created_at TEXT NOT NULL
);
