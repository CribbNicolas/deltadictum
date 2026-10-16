// Whether a change set reaches npm users, and so needs a version and a changelog entry.
// A path ships when an entry of package.json "files" covers it and no "!" entry excludes
// it, or when it is one of the files npm always packs. Deciding from "files" rather than
// from a packed list counts a deleted file too.
import { execFileSync } from 'node:child_process';

const ALWAYS =[/^package\.json$/, /^README(\.[^/]*)?$/i, /^LICEN[CS]E(\.[^/]*)?$/i];

const covers = (entry, path) => path === entry || path.startsWith(`${entry.replace(/\/$/, '')}/`);

export function isShipped(path, files) {
  if (ALWAYS.some(pattern => pattern.test(path))) return true;
  const included = files.filter(entry => !entry.startsWith('!')).some(entry => covers(entry, path));
  const excluded = files.filter(entry => entry.startsWith('!')).some(entry => covers(entry.slice(1), path));
  return included && !excluded;
}

// The paths a branch changed since it left the base. --no-renames lists a moved file at both
// paths: with rename detection, a file moved out of the package would show only its new path.
export function changedFiles(baseRef, { cwd } = {}) {
  return execFileSync('git', ['diff', '--name-only', '--no-renames', `${baseRef}...HEAD`], { cwd, encoding: 'utf8' })
    .split(/\r?\n/).filter(Boolean);
}

export function needsRelease(changed, files) {
  return changed.some(path => isShipped(path, files));
}
