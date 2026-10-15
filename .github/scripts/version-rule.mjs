// Whether a change set reaches npm users, and so needs a version and a changelog entry.
// A path ships when an entry of package.json "files" covers it and no "!" entry excludes
// it, or when it is one of the files npm always packs. Deciding from "files" rather than
// from a packed list counts a deleted file too.
const ALWAYS = [/^package\.json$/, /^README(\.[^/]*)?$/i, /^LICEN[CS]E(\.[^/]*)?$/i];

const covers = (entry, path) => path === entry || path.startsWith(`${entry.replace(/\/$/, '')}/`);

export function isShipped(path, files) {
  if (ALWAYS.some(pattern => pattern.test(path))) return true;
  const included = files.filter(entry => !entry.startsWith('!')).some(entry => covers(entry, path));
  const excluded = files.filter(entry => entry.startsWith('!')).some(entry => covers(entry.slice(1), path));
  return included && !excluded;
}

export function needsRelease(changed, files) {
  return changed.some(path => isShipped(path, files));
}
