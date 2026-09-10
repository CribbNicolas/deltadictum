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

export function atomFilePath(supermemDir, topicKey) {
  const parts = assertTopicKeyPath(topicKey);
  return join(supermemDir, 'atoms', ...parts) + '.json';
}

export function archiveFilePath(supermemDir, id) {
  if (!id || String(id).includes('..') || String(id).includes('/') || String(id).includes('\\')) {
    throw new Error('invalid_atom_id');
  }
  return join(supermemDir, 'archive', `${id}.json`);
}

export const LIVE_STATES = ['candidate', 'active', 'contested'];
export const ARCHIVE_STATES = ['superseded', 'archived', 'rejected'];

export function topicKeyFromAtomFile(supermemDir, filePath) {
  const rel = relative(join(supermemDir, 'atoms'), filePath).replaceAll('\\', '/');
  if (!rel.endsWith('.json')) return null;
  const key = rel.slice(0, -'.json'.length);
  assertTopicKeyPath(key);
  if (rel.split(sep).includes('..')) throw new Error('path_traversal');
  return key;
}

export function registryPath(supermemDir) {
  return join(supermemDir, 'registry', 'topics.json');
}

export function relationsPath(supermemDir) {
  return join(supermemDir, 'relations.json');
}

export function configPath(supermemDir) {
  return join(supermemDir, 'config.json');
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
  auto_admit: {
    lesson: 'candidate',
    anti_memory: 'active',
    procedure: 'candidate',
    decision: 'candidate',
    claim: 'candidate',
  },
  health: DEFAULT_HEALTH_THRESHOLDS,
};
