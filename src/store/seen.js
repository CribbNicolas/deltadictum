import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataBase } from '../project.js';

function seenPath() {
  return join(resolveDataBase(), 'seen.json');
}

export async function readSeen() {
  try {
    return JSON.parse(await readFile(seenPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

// Several ids in one write: one read-modify-write per id would race and drop some.
export async function markSeen(...ids) {
  const seen = await readSeen();
  const fresh = ids.filter(id => typeof id === 'string' && id && !seen[id]);
  if (!fresh.length) return;
  const at = new Date().toISOString();
  for (const id of fresh) seen[id] = at;
  await mkdir(resolveDataBase(), { recursive: true, mode: 0o700 });
  await writeFile(seenPath(), JSON.stringify(seen), 'utf8');
}

export function isSeen(id, seen) {
  return Boolean(seen[id]);
}
