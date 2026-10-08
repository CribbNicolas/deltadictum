import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Derived files never belong in git: local/ (compiled index, session ledgers,
// telemetry) and the memory manifest, which two branches would always conflict
// on. Each entry is appended to .dd/.gitignore once.
export const DERIVED_ENTRIES = ['local/', 'memories/manifest.json'];

export async function ensureIgnored(ddDir, entries = DERIVED_ENTRIES) {
  const file = join(ddDir, '.gitignore');
  let text = '';
  try { text = await readFile(file, 'utf8'); } catch (err) { if (err.code !== 'ENOENT') throw err; }
  const present = new Set(text.split(/\r?\n/).map(line => line.trim()));
  const missing = entries.filter(entry => !present.has(entry));
  if (!missing.length) return false;
  await mkdir(ddDir, { recursive: true });
  await writeFile(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${missing.join('\n')}\n`);
  return true;
}
