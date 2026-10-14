import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { appendFootprint, footprintPath, readFootprint } from '../capture/footprint.js';
import { appendTelemetry, telemetryDir } from '../capture/telemetry.js';
import { PATH_FLAGS } from '../engine/clause.cjs';
import { loadIndex, readBodies } from '../engine/index-file.cjs';
import { ledgerPath, openLedger, REPORT_LIMIT } from '../engine/ledger.cjs';
import { localPaths } from '../engine/locate.cjs';
import { CONTENT_MAX, evaluateContent } from './check.cjs';
import { createMatcher } from './pattern.cjs';

// Turn checks (spec section 6): at Stop, once, over the final state of the files
// the turn changed — its edits and writes, and files its commands named that git
// reports as changed. Intermediate states never raise an alarm.
const CHECKS_FILE = 'checks.jsonl';
const telemetryPath = root => join(telemetryDir(root), CHECKS_FILE);
const record = (root, entry) => appendTelemetry(root, CHECKS_FILE, entry);

// Modified since `since` (ms): a command that names a file changed it only if the
// file's modification time says so. Running a test file does not change it.
function modifiedSince(root, file, since) {
  // Whole milliseconds, as the marker's time is: a write in the very millisecond
  // of the previous Stop belongs to that turn.
  try { return Math.floor(statSync(join(root, file)).mtimeMs) > since; } catch { return false; }
}

function readSmall(file) {
  try { return statSync(file).size > CONTENT_MAX * 4 ? null : readFileSync(file, 'utf8'); } catch { return null; }
}

// The file as the last commit has it, or null (a new file, no git). A violation
// already there is not the turn's doing and is not reported (owner, 2026-10-13):
// the agent is not sent to fix old code outside its task.
function committedContent(root, file) {
  // `./` makes the path relative to the project, which may be a subfolder of the repository.
  const shown = spawnSync('git', ['-C', root, 'show', `HEAD:./${file}`], { encoding: 'utf8', windowsHide: true, maxBuffer: CONTENT_MAX * 8 });
  return shown.status === 0 ? shown.stdout : null;
}

export function turnViolations(root, payload, { now = new Date() } = {}) {
  const path = footprintPath(root, payload.session_id);
  if (!path) return '';
  // This turn: everything after the previous Stop's marker. The previous Stop's
  // violations were written after its marker, so they open this segment.
  const entries = readFootprint(path);
  const marker = entries.findLastIndex(e => e.t === 'turn');
  const since = marker >= 0 ? Date.parse(entries[marker].at) || 0 : 0;
  const turn = entries.slice(marker + 1);
  const tools = turn.filter(e => e.t === 'tool');
  const editedPaths = new Set(tools.filter(e => e.kind === 'edit' || e.kind === 'write').flatMap(e => e.paths ?? []));
  for (const file of tools.filter(e => e.kind === 'run').flatMap(e => e.paths ?? [])) {
    if (modifiedSince(root, file, since)) editedPaths.add(file);
  }
  appendFootprint(path, { t: 'turn', at: now.toISOString() });

  const index = loadIndex(root);
  const checks = (index?.checks ?? []).filter(check => check.when === 'turn');
  const lines = [];
  const reportedNow = new Set();
  if (checks.length) {
    const matcher = createMatcher();
    const bodies = readBodies(root, index) ?? {};
    const ledger = openLedger(ledgerPath(localPaths(root).sessions, payload.session_id, payload.agent_id));
    for (const file of editedPaths) {
      const relevant = checks.filter(check => (check.paths ?? []).some(source => new RegExp(source, PATH_FLAGS).test(file)));
      if (!relevant.length) continue;
      const content = readSmall(join(root, file));
      if (content === null) continue;
      let committed;
      const before = () => (committed === undefined ? (committed = committedContent(root, file)) : committed);
      for (const check of relevant) {
        if (!evaluateContent(check, content, matcher).violated) continue;
        if (before() !== null && evaluateContent(check, before(), matcher).violated) continue;
        reportedNow.add(`${check.m}\0${file}`);
        if (ledger.reported(check.m, file) >= REPORT_LIMIT) continue;
        ledger.report(check.m, file);
        appendFootprint(path, { t: 'violation', m: check.m, path: file, at: now.toISOString() });
        const body = !ledger.delivered().has(check.m) ? bodies[check.m]?.body : null;
        if (body) ledger.claim([check.m], { kind: 'turn', viaOf: () => ['check'] });
        lines.push(`DD - check (${index.memories[check.m]?.title ?? check.m}): ${check.say} (${file})${body ? `\n${body}` : ''}`);
      }
    }
  }
  // The previous Stop's reports: fixed, repeated, or left alone (a suspected false alarm).
  for (const violation of turn.filter(e => e.t === 'violation')) {
    const outcome = !editedPaths.has(violation.path) ? 'ignored' : reportedNow.has(`${violation.m}\0${violation.path}`) ? 'repeated' : 'fixed';
    record(root, { m: violation.m, path: violation.path, outcome, at: now.toISOString() });
  }
  return lines.join('\n');
}

export function suspectedFalseAlarms(root, { threshold = 3 } = {}) {
  let text = '';
  try { text = readFileSync(telemetryPath(root), 'utf8'); } catch { return []; }
  const ignored = new Map();
  for (const line of text.split('\n').filter(Boolean)) {
    try { const entry = JSON.parse(line); if (entry.outcome === 'ignored') ignored.set(entry.m, (ignored.get(entry.m) ?? 0) + 1); } catch { /* torn line */ }
  }
  return [...ignored].filter(([, count]) => count >= threshold).map(([memory, count]) => ({ memory, ignored: count }));
}
