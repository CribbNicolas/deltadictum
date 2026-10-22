import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { autoAcceptEnabled } from '../capture/auto-accept.js';
import { compileProject } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { AFTER_SESSIONS, afterSessionsOf, validAfterSessions } from '../maintenance/retire.js';
import { ReviewError } from './actions.js';

// The settings the review UI reads and changes, every one DD has. The project's live in .dd/config.json,
// committed, so the team shares them: every other key the file holds is kept as it is. This machine's live
// in .dd/local/settings.json, never committed (src/engine/machine.cjs).
const require = createRequire(import.meta.url);
const { LIMIT, LIMIT_MIN, LIMIT_MAX, validLimit } = require('../engine/deliver.cjs');
const { MACHINE_DEFAULTS, MACHINE_FILE, PAYLOADS_FILE, machineSettings } = require('../engine/machine.cjs');

// project_id is the label written into new memories; the ones already written keep theirs.
const validProjectId = value => typeof value === 'string' && value.trim() !== '' && value.length <= 100 && !/[\u0000-\u001f]/.test(value);
const PROJECT = { project_id: validProjectId, auto_accept: value => typeof value === 'boolean', delivery_limit: validLimit,
  retire_after_sessions: validAfterSessions };
const MACHINE = Object.fromEntries(Object.keys(MACHINE_DEFAULTS).map(key => [key, value => typeof value === 'boolean']));
export const LIMITS = { delivery_limit: { min: LIMIT_MIN, max: LIMIT_MAX, default: LIMIT }, retire_after_sessions: AFTER_SESSIONS };

const configPath = root => join(localPaths(root).dd, 'config.json');
const machinePath = root => join(localPaths(root).local, MACHINE_FILE);

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) ?? {}; } catch { return {}; }
}

export function readSettings(root) {
  const file = readJson(configPath(root));
  return { project_id: typeof file.project_id === 'string' ? file.project_id : null, auto_accept: autoAcceptEnabled(file),
    delivery_limit: validLimit(file.delivery_limit) ? file.delivery_limit : LIMIT, retire_after_sessions: afterSessionsOf(root),
    machine: { ...machineSettings(localPaths(root).local), payloads_file: `.dd/local/${PAYLOADS_FILE}` }, limits: LIMITS, file };
}

export async function writeSettings(root, changes) {
  const { machine = {}, ...project } = changes ?? {};
  const problems = [];
  for (const [key, value] of Object.entries(project)) {
    if (!PROJECT[key]) problems.push(`not_a_setting:${key}`);
    else if (!PROJECT[key](value)) problems.push(`invalid_setting:${key}`);
  }
  for (const [key, value] of Object.entries(machine ?? {})) {
    if (!MACHINE[key]) problems.push(`not_a_setting:machine.${key}`);
    else if (!MACHINE[key](value)) problems.push(`invalid_setting:machine.${key}`);
  }
  if (problems.length) throw new ReviewError(problems);
  if (Object.keys(project).length) {
    // retire_after_sessions is the file's retire.after_sessions; the rest of retire is kept.
    const { retire_after_sessions: afterSessions, ...flat } = project;
    if (typeof flat.project_id === 'string') flat.project_id = flat.project_id.trim();
    const file = readJson(configPath(root));
    const next = { ...file, ...flat, ...(afterSessions === undefined ? {} : { retire: { ...file.retire, after_sessions: afterSessions } }) };
    writeFileSync(configPath(root), `${JSON.stringify(next, null, 2)}\n`);
  }
  if (Object.keys(machine ?? {}).length) {
    mkdirSync(localPaths(root).local, { recursive: true });
    writeFileSync(machinePath(root), `${JSON.stringify({ ...readJson(machinePath(root)), ...machine }, null, 2)}\n`);
  }
  // The cap lives in the compiled index: a change applies at the next hook.
  if ('delivery_limit' in project) await compileProject(root);
  return readSettings(root);
}
