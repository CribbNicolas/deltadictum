import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function walkJsonFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walkJsonFiles(full, acc);
    else if (entry.isFile() && entry.name.endsWith('.json')) acc.push(full);
  }
  return acc;
}

export async function sourceFingerprint(supermemDir) {
  const files = [
    ...await walkJsonFiles(join(supermemDir, 'atoms')),
    ...await walkJsonFiles(join(supermemDir, 'archive')),
    join(supermemDir, 'registry', 'topics.json'),
    join(supermemDir, 'relations.json'),
  ].sort();
  const hash = createHash('sha256');
  for (const file of files) {
    try {
      const body = await readFile(file);
      hash.update(file);
      hash.update('\0');
      hash.update(body);
    } catch {
      hash.update(file);
      hash.update('\0missing\0');
    }
  }
  return hash.digest('hex');
}
