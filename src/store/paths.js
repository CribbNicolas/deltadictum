import { join, relative, sep } from 'node:path';
import { DEFAULT_HEALTH_THRESHOLDS } from '../engine/health/deterioration.js';

const KEY_SEGMENT = /^[a-z0-9_-]+$/;

export function assertTopicKeyPath(topicKey) {
  const raw = String(topicKey ?? '');
  const parts = raw.split('/');
  if (parts.length < 2 || parts.length > 4) {
    throw new Error(`invalid_topic_key_path:${raw}`);
  }
  for (const part of parts) {
    if (!KEY_SEGMENT.test(part)) {
      throw new Error(`invalid_topic_key_segment:${part}`);
    }
  }
  return parts;
}

export function atomFilePath(ddDir, topicKey) {
  const parts = assertTopicKeyPath(topicKey);
  return join(ddDir, 'atoms', ...parts) + '.json';
}

export function archiveFilePath(ddDir, id) {
  if (!/^[a-zA-Z0-9_-]+$/.test(String(id ?? ''))) {
    throw new Error('invalid_atom_id');
  }
  return join(ddDir, 'archive', `${id}.json`);
}

export const LIVE_STATES = ['candidate', 'active', 'contested'];
export function candidateFilePath(ddDir, id) {
  archiveFilePath(ddDir, id);
  return join(ddDir, 'candidates', `${id}.json`);
}
export const ARCHIVE_STATES = ['superseded', 'archived', 'rejected'];
export const EFFECTIVE_STATES = ['active', 'contested'];
// Legacy knowledge is recalled as a warning; see src/engine/retrieve.js.
export const RECALL_STATES = ['active', 'contested', 'legacy'];

export function legacyFilePath(ddDir, id) {
  archiveFilePath(ddDir, id);
  return join(ddDir, 'legacy', `${id}.json`);
}

// A pending action (src/engine/actions.js): a request a person applies in the audit UI.
export function actionFilePath(ddDir, id) {
  archiveFilePath(ddDir, id);
  return join(ddDir, 'actions', `${id}.json`);
}

export function topicKeyFromAtomFile(ddDir, filePath) {
  const rel = relative(join(ddDir, 'atoms'), filePath).replaceAll('\\', '/');
  if (!rel.endsWith('.json')) return null;
  const key = rel.slice(0, -'.json'.length);
  assertTopicKeyPath(key);
  if (rel.split(sep).includes('..')) throw new Error('path_traversal');
  return key;
}

export function registryPath(ddDir) {
  return join(ddDir, 'registry', 'topics.json');
}

export function relationsPath(ddDir) {
  return join(ddDir, 'relations.json');
}

export function configPath(ddDir) {
  return join(ddDir, 'config.json');
}

export function observationsPath(dataDir) {
  return join(dataDir, 'observations.jsonl');
}

export function sqlitePath(dataDir) {
  return join(dataDir, 'index.sqlite');
}

export const DEFAULT_CONFIG = {
  project_id: null,
  budget_tokens: 600,
  vpt_threshold: 0.02,
  // Semantic retrieval in the resident process: how far above the query's mean
  // similarity a memory must stand. Lower reaches terser memories, less quietly.
  semantic: { floor: 0.04 },
  auto_admit: {
    lesson: 'candidate',
    anti_memory: 'candidate',
    procedure: 'candidate',
    decision: 'candidate',
    claim: 'candidate',
  },
  auto_accept: { enabled: true, confidence_threshold: 0.765 },
  health: DEFAULT_HEALTH_THRESHOLDS,
  capture: { retention_days: 14, max_observations: 200 },
  telemetry: { retention_days: 90, max_events: 2000 },
  session: { retention_hours: 24, max_entries: 500 },
  // Past this many archived memories, the session start asks for a cleanup.
  archive_review_at: 50,
};
