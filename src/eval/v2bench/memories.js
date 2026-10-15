import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertV1 } from '../../memory/convert-v1.js';

// The memories the bench replays. Plan 0 read the live v1 atoms and converted
// them; the migration removed the atoms and wrote the same memories, under the
// same ids, to .dd/memories/. Atoms when they are still there, the v2 memories
// otherwise: the live ones and the archived ones, because the bench is a frozen
// harness around a recorded trial and a curation that archives a memory must not
// read as the engine missing it. Superseded versions and candidates were never
// delivered and stay out.
const REPLAYED = ['active', 'contested', 'archived'];

async function jsonFilesUnder(dir, { recursive = true } = {}) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isDirectory()) { if (recursive) found.push(...await jsonFilesUnder(join(dir, entry.name))); continue; }
    if (entry.name.endsWith('.json') && entry.name !== 'manifest.json') found.push(JSON.parse(await readFile(join(dir, entry.name), 'utf8')));
  }
  return found;
}

async function readV1(ddDir) {
  const atoms = [...await jsonFilesUnder(join(ddDir, 'atoms')), ...await jsonFilesUnder(join(ddDir, 'legacy'))];
  return atoms.filter(atom => ['active', 'contested', 'legacy'].includes(atom.lifecycle_state));
}

export async function loadBenchMemories(ddDir) {
  const v1 = await readV1(ddDir);
  if (v1.length) {
    const titles = new Map(v1.map(atom => [atom.id, atom.title]));
    const liveByTopic = new Map(v1.filter(atom => atom.lifecycle_state !== 'legacy').map(atom => [atom.topic_key, atom.title]));
    return v1.map(atom => convertV1(atom, { titles, liveByTopic }));
  }
  // Replayed as they were when the trial ran: the engine compiles live memories only.
  return (await jsonFilesUnder(join(ddDir, 'memories'), { recursive: false })).filter(memory => REPLAYED.includes(memory.status))
    .map(memory => (memory.status === 'archived' ? { ...memory, status: 'active' } : memory));
}
