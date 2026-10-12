import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { appendFootprint, footprintPath, readFootprint } from '../capture/footprint.js';
import { PATH_FLAGS } from '../engine/clause.cjs';
import { loadIndex, readBodies } from '../engine/index-file.cjs';
import { ledgerPath, openLedger, REPORT_LIMIT } from '../engine/ledger.cjs';
import { localPaths } from '../engine/locate.cjs';
import { CONTENT_MAX, evaluateContent } from './check.cjs';
import { createMatcher } from './pattern.cjs';

// Turn checks (spec section 6): at Stop, once, over the final state of the files
// the turn changed — its edits and writes, and files its commands named that git
// reports as changed. Intermediate states never raise an alarm.
const telemetryDir = root => join(localPaths(root).local, 'telemetry');
const telemetryPath = root => join(telemetryDir(root), 'checks.jsonl');

function record(root, entry) {
  try { mkdirSync(telemetryDir(root), { recursive: true }); appendFileSync(telemetryPath(root), `${JSON.stringify(entry)}\n`); } catch { /* telemetry is best effort */ }
}

function gitChanged(root) {
  try {
    return new Set(execFileSync('git', ['-C', root, 'diff', '--name-only'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      .split('\n').filter(Boolean));
  } catch { return new Set(); }
}

function readSmall(file) {
  try { return statSync(file).size > CONTENT_MAX * 4 ? null : readFileSync(file, 'utf8'); } catch { return null; }
}

export function turnViolations(root, payload, { now = new Date() } = {}) {
  const path = footprintPath(root, payload.session_id);
  if (!path) return '';
  // This turn: everything after the previous Stop's marker. The previous Stop's
  // violations were written after its marker, so they open this segment.
  const entries = readFootprint(path);
  const turn = entries.slice(entries.findLastIndex(e => e.t === 'turn') + 1);
  const tools = turn.filter(e => e.t === 'tool');
  const editedPaths = new Set(tools.filter(e => e.kind === 'edit' || e.kind === 'write').flatMap(e => e.paths ?? []));
  const named = tools.filter(e => e.kind === 'run').flatMap(e => e.paths ?? []);
  if (named.length) {
    const changed = gitChanged(root);
    for (const file of named) if (changed.has(file)) editedPaths.add(file);
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
      for (const check of relevant) {
        if (!evaluateContent(check, content, matcher).violated) continue;
        reportedNow.add(`${check.m}\0${file}`);
        if (ledger.reported(check.m, file) >= REPORT_LIMIT) continue;
        ledger.report(check.m, file);
        appendFootprint(path, { t: 'violation', m: check.m, path: file, at: now.toISOString() });
        const body = !ledger.delivered().has(check.m) ? bodies[check.m]?.body : null;
        if (body) ledger.claim([check.m]);
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
