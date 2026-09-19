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

export async function markSeen(id) {
  const seen = await readSeen();
  if (seen[id]) return;
  seen[id] = new Date().toISOString();
  await mkdir(resolveDataBase(), { recursive: true });
  await writeFile(seenPath(), JSON.stringify(seen), 'utf8');
}

export function isSeen(id, seen) {
  return Boolean(seen[id]);
}
