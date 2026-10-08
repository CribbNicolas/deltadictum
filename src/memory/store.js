import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { commitTransaction, createWriteLock, recoverTransaction } from '../store/transactions.js';
import { LIVE_STATUSES, orderMemory, serializeMemory, validateMemory } from './schema.js';

// v2 knowledge: .dd/memories/<id>.json, one memory per file, and manifest.json,
// rewritten on every commit so a hook can tell its compiled index is stale with
// one read (docs/research/2026-10-v2-bench-report.md, decision 4).
export const MANIFEST = 'manifest.json';

export function manifestOf(memories) {
  const entries = memories.map(memory => `${memory.id}:${createHash('sha256').update(serializeMemory(memory)).digest('hex')}`).sort();
  return { version: 1, count: memories.length, hash: createHash('sha256').update(entries.join('\n')).digest('hex') };
}

export function createMemoryFiles(ddDir) {
  const dir = join(ddDir, 'memories');
  const withWriteLock = createWriteLock(ddDir);
  const fileOf = id => `memories/${id}.json`;

  // Every memory file with the reasons it cannot be used; a broken file never
  // stops the others from being read (L5).
  async function readAll() {
    let names;
    try { names = await readdir(dir); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
    return Promise.all(names.filter(name => name.endsWith('.json') && name !== MANIFEST).map(async name => {
      try {
        const memory = JSON.parse(await readFile(join(dir, name), 'utf8'));
        return { name, memory, reasons: validateMemory(memory) };
      } catch { return { name, memory: null, reasons: ['invalid_json'] }; }
    }));
  }
  const usable = async () => (await readAll()).filter(entry => entry.memory && !entry.reasons.length).map(entry => entry.memory);

  const list = async ({ statuses } = {}) => (await usable()).filter(memory => !statuses || statuses.includes(memory.status));
  const get = async id => (await usable()).find(memory => memory.id === id) ?? null;
  const unsupported = async () => (await readAll()).filter(entry => entry.reasons.length)
    .map(entry => ({ path: `memories/${entry.name}`, id: entry.memory?.id ?? null, reasons: entry.reasons }));

  // Writes and removals in one journaled transaction with the manifest. Every
  // memory is validated before anything is written, and no two live memories
  // share a topic once the commit lands.
  async function commit({ put = [], remove = [], preserveDates = false } = {}) {
    return withWriteLock(async () => {
      await recoverTransaction(ddDir);
      const now = new Date().toISOString();
      const current = await usable();
      const previous = new Map(current.map(memory => [memory.id, memory]));
      const stored = put.map(memory => {
        const next = {
          ...memory,
          created: previous.get(memory.id)?.created ?? memory.created ?? now,
          updated: preserveDates && memory.updated ? memory.updated : now,
        };
        const reasons = validateMemory(next);
        if (reasons.length) throw new Error(`memory_invalid:${memory.id}:${reasons.join(',')}`);
        return orderMemory(next);
      });
      const removed = new Set(remove.map(entry => (typeof entry === 'string' ? entry : entry.id)));
      const after = new Map(current.filter(memory => !removed.has(memory.id)).map(memory => [memory.id, memory]));
      for (const memory of stored) after.set(memory.id, memory);
      // Only the topics this commit makes live are checked: a conflict a git merge
      // left on disk is reported by conflicts() and blocks only writes to its topic.
      const live = [...after.values()].filter(memory => LIVE_STATUSES.includes(memory.status));
      for (const topic of new Set(stored.filter(memory => LIVE_STATUSES.includes(memory.status)).map(memory => memory.topic))) {
        if (live.filter(memory => memory.topic === topic).length > 1) throw new Error(`live_topic_conflict:${topic}`);
      }
      const written = new Set(stored.map(memory => memory.id));
      await commitTransaction(ddDir, [
        ...[...removed].filter(id => !written.has(id)).map(id => ({ path: fileOf(id), value: null })),
        ...stored.map(memory => ({ path: fileOf(memory.id), value: memory })),
        { path: `memories/${MANIFEST}`, value: manifestOf([...after.values()]) },
      ]);
      return stored;
    });
  }

  // Topics with more than one live memory (a merge can bring two in), for the health report.
  async function conflicts() {
    const byTopic = new Map();
    for (const memory of await list({ statuses: LIVE_STATUSES })) byTopic.set(memory.topic, [...(byTopic.get(memory.topic) ?? []), memory.id]);
    return [...byTopic].filter(([, ids]) => ids.length > 1).map(([topic, ids]) => ({ topic, ids: ids.sort() }));
  }

  async function manifest() {
    try { return JSON.parse(await readFile(join(dir, MANIFEST), 'utf8')); } catch { return null; }
  }

  return { ddDir, list, get, unsupported, conflicts, commit, manifest };
}
