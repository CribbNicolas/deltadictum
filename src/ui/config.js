import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoAcceptEnabled } from '../capture/auto-accept.js';
import { localPaths } from '../engine/locate.cjs';
import { ReviewError } from './actions.js';

// The project's settings (.dd/config.json), read and changed from the review UI.
// Only the settings DD reads can be changed here; every other key the file holds
// is kept as it is, and project_id is shown but never edited from the UI.
const SETTINGS = { auto_accept: value => typeof value === 'boolean' };

const pathOf = root => join(localPaths(root).dd, 'config.json');

function readFile(root) {
  try { return JSON.parse(readFileSync(pathOf(root), 'utf8')); } catch { return {}; }
}

export function readSettings(root) {
  const file = readFile(root);
  return { project_id: typeof file.project_id === 'string' ? file.project_id : null, auto_accept: autoAcceptEnabled(file), file };
}

export function writeSettings(root, changes) {
  const problems = [];
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (!SETTINGS[key]) problems.push(`not_a_setting:${key}`);
    else if (!SETTINGS[key](value)) problems.push(`invalid_setting:${key}`);
  }
  if (problems.length) throw new ReviewError(problems);
  const next = { ...readFile(root), ...changes };
  writeFileSync(pathOf(root), `${JSON.stringify(next, null, 2)}\n`);
  return readSettings(root);
}
