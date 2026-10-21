import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

// The replayed memories frozen beside the trial's events (2026-10-21), so the project's
// own store can be curated, its archived and superseded memories deleted, without
// moving a bench figure. --memories=store replays the store as it is now instead.
export const FROZEN_MEMORIES = fileURLToPath(new URL('./fixtures/trial-memories.json.gz', import.meta.url));

export async function frozenBenchMemories(path = FROZEN_MEMORIES) {
  return JSON.parse(gunzipSync(await readFile(path)).toString('utf8'));
}

export async function freezeBenchMemories(memories, path = FROZEN_MEMORIES) {
  const sorted = [...memories].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  await writeFile(path, gzipSync(`${JSON.stringify(sorted)}\n`, { level: 9 }));
  return sorted.length;
}

// A project's store as the bench replays it: the live memories and the archived
// ones, because the bench is a frozen harness around a recorded trial and a
// curation that archives a memory must not read as the engine missing it.
// Superseded versions and candidates were never delivered and stay out.
const REPLAYED = ['active', 'contested', 'archived'];

export async function loadBenchMemories(ddDir) {
  const dir = join(ddDir, 'memories');
  const names = (await readdir(dir).catch(() => [])).filter(name => name.endsWith('.json') && name !== 'manifest.json');
  const memories = await Promise.all(names.map(async name => JSON.parse(await readFile(join(dir, name), 'utf8'))));
  // Replayed as they were when the trial ran: the engine compiles live memories only.
  return memories.filter(memory => REPLAYED.includes(memory.status))
    .map(memory => (memory.status === 'archived' ? { ...memory, status: 'active' } : memory));
}
