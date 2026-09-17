import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
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

export async function sourceFingerprint(ddDir) {
  const files = [
    ...await walkJsonFiles(join(ddDir, 'atoms')),
    ...await walkJsonFiles(join(ddDir, 'archive')),
    ...await walkJsonFiles(join(ddDir, 'candidates')),
    join(ddDir, 'registry', 'topics.json'),
    join(ddDir, 'relations.json'),
  ].sort();
  const hash = createHash('sha256');
  // Metadata detects normal editor/git changes without rereading every atom body
  // on each hook invocation. Evidence uses separate SHA-256 content verification.
  for (let start = 0; start < files.length; start += 32) {
    const stamps = await Promise.all(files.slice(start, start + 32).map(async file => {
      try { const s = await stat(file); return `${file}\0${s.size}:${s.mtimeMs}:${s.ctimeMs}`; }
      catch (err) { if (err.code === 'ENOENT') return `${file}\0missing`; throw err; }
    }));
    for (const stamp of stamps) hash.update(stamp);
  }
  return hash.digest('hex');
}
