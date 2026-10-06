// Prints the CHANGELOG.md section of one version, without its heading, or
// nothing when there is none.
// Usage: node .github/scripts/release-notes.mjs <version>
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  // A plain prefix match: the version is input, so it never becomes a pattern.
  const heading = `## [${version}]`;
  const start = lines.findIndex(line => line.startsWith(heading));
  if (start < 0) return '';
  const end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv[2]) {
  let changelog = '';
  try { changelog = readFileSync('CHANGELOG.md', 'utf8'); } catch { /* no changelog: empty notes */ }
  const notes = releaseNotes(changelog, process.argv[2]);
  if (notes) console.log(notes);
}
