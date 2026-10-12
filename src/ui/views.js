import { createRequire } from 'node:module';
import { listRequests } from './requests.js';
import { namedSymbols } from '../capture/generic.js';
import { exampleProblems } from '../checks/check.cjs';
import { createMatcher } from '../checks/pattern.cjs';
import { globToRegExp } from '../engine/clause.cjs';
import { codeSymbols, repoFilesOf } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { healthReport } from '../maintenance/health.js';
import { status } from '../maintenance/recall.js';
import { overlaps, refreshSimilarity, similarTo, suggestTriggersFor } from '../maintenance/similar.js';
import { openTelemetry } from '../maintenance/telemetry.js';
import { createMemoryFiles } from '../memory/store.js';

const { staleEvidence } = createRequire(import.meta.url)('../engine/deliver.cjs');

// What the review UI reads (spec section 8): queues from health, a memory with
// its breadth, its check and its evidence. Nothing here writes.
export const QUEUES = ['candidates', 'stale', 'hubs', 'dead', 'false_alarms', 'duplicates', 'missing_not_derivable', 'requests', 'all'];
const SIGNAL_QUEUES = { stale: 'stale_evidence', hubs: 'hub', dead: 'dead_trigger', false_alarms: 'suspected_false_alarm' };

async function snapshot(root) {
  const store = createMemoryFiles(localPaths(root).dd);
  const memories = await store.list();
  const health = await healthReport(root);
  const signals = new Map(health.memories.map(m => [m.id, m]));
  const db = openTelemetry(root);
  let pairs;
  try {
    refreshSimilarity(root, db, memories, (await store.manifest())?.hash ?? '');
    pairs = overlaps(memories.filter(m => m.status !== 'archived' && m.status !== 'superseded'), db);
  } finally { db.close(); }
  return { memories, health, signals, pairs };
}

function queueIds({ memories, health, signals, pairs }, queue) {
  if (queue === 'all') return memories.map(m => m.id);
  if (queue === 'candidates') return health.queues.candidates;
  if (queue === 'missing_not_derivable') return health.queues.migrated_without_not_derivable;
  if (queue === 'duplicates') return [...new Set(pairs.flatMap(pair => [pair.a, pair.b]))];
  const signal = SIGNAL_QUEUES[queue];
  return signal ? [...signals.values()].filter(m => m.signals.some(s => s.signal === signal)).map(m => m.id) : [];
}

export async function overview(root) {
  const snap = await snapshot(root);
  const queues = Object.fromEntries(QUEUES.filter(q => q !== 'requests').map(q => [q, queueIds(snap, q).length]));
  return { status: await status(root), queues: { ...queues, requests: listRequests(root).length } };
}

export async function listMemories(root, { queue = 'all' } = {}) {
  const snap = await snapshot(root);
  const ids = new Set(queueIds(snap, queue));
  return snap.memories.filter(m => ids.has(m.id)).map(m => ({ id: m.id, topic: m.topic, title: m.title, kind: m.kind, status: m.status,
    signals: snap.signals.get(m.id)?.signals ?? [] })).sort((a, b) => a.topic.localeCompare(b.topic));
}

export async function memoryDetail(root, id) {
  const store = createMemoryFiles(localPaths(root).dd);
  const memories = await store.list();
  const memory = memories.find(m => m.id === id);
  if (!memory) return null;
  const repoFiles = repoFilesOf(root) ?? [];
  const breadth = memory.triggers.flatMap(clause => clause.paths ?? [])
    .map(glob => ({ glob, files: repoFiles.filter(file => globToRegExp(glob).test(file)).length }));
  const health = (await healthReport(root)).memories.find(m => m.id === id);
  const db = openTelemetry(root);
  let similar;
  try {
    refreshSimilarity(root, db, memories, (await store.manifest())?.hash ?? '');
    similar = similarTo(db, `${memory.title} ${memory.body}`, { limit: 5, exclude: [id] });
  } finally { db.close(); }
  const titles = new Map(memories.map(m => [m.id, m.title]));
  let suggested = [];
  if (!memory.triggers.length) {
    const found = codeSymbols(root, namedSymbols(memory));
    suggested = suggestTriggersFor(memory, { repoFiles, symbolExists: name => Boolean(found?.has(name)) });
  }
  return {
    memory, breadth, fired: health?.fired ?? 0, opportunity: health?.opportunity ?? 0, signals: health?.signals ?? [],
    check: { problems: memory.check ? exampleProblems(memory.check, createMatcher()) : [] },
    stale: staleEvidence(root, memory.evidence.filter(entry => entry.type === 'file' && entry.sha256)),
    similar: similar.map(hit => ({ id: hit.id, title: titles.get(hit.id) })), suggested_triggers: suggested,
  };
}
