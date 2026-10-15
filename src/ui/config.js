import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { autoAcceptEnabled } from '../capture/auto-accept.js';
import { compileProject } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { ReviewError } from './actions.js';

// The project's settings (.dd/config.json), read and changed from the review UI.
// Only the settings DD reads can be changed here; every other key the file holds
// is kept as it is, and project_id is shown but never edited from the UI.
const { LIMIT, LIMIT_MIN, LIMIT_MAX, validLimit } = createRequire(import.meta.url)('../engine/deliver.cjs');
const SETTINGS = { auto_accept: value => typeof value === 'boolean', delivery_limit: validLimit };
export const LIMITS = { delivery_limit: { min: LIMIT_MIN, max: LIMIT_MAX, default: LIMIT } };

const pathOf = root => join(localPaths(root).dd, 'config.json');

function readFile(root) {
  try { return JSON.parse(readFileSync(pathOf(root), 'utf8')); } catch { return {}; }
}

export function readSettings(root) {
  const file = readFile(root);
  return { project_id: typeof file.project_id === 'string' ? file.project_id : null, auto_accept: autoAcceptEnabled(file),
    delivery_limit: validLimit(file.delivery_limit) ? file.delivery_limit : LIMIT, limits: LIMITS, file };
}

export async function writeSettings(root, changes) {
  const problems = [];
  for (const [key, value] of Object.entries(changes ?? {})) {
    if (!SETTINGS[key]) problems.push(`not_a_setting:${key}`);
    else if (!SETTINGS[key](value)) problems.push(`invalid_setting:${key}`);
  }
  if (problems.length) throw new ReviewError(problems);
  const next = { ...readFile(root), ...changes };
  writeFileSync(pathOf(root), `${JSON.stringify(next, null, 2)}\n`);
  // The cap lives in the compiled index: a change applies at the next hook.
  if ('delivery_limit' in changes) await compileProject(root);
  return readSettings(root);
}
