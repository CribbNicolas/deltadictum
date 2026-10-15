import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { autoAcceptEnabled } from '../capture/auto-accept.js';
import { repoFilesOf } from '../engine/compile.js';
import { loadIndex, needsCompile } from '../engine/index-file.cjs';
import { localPaths } from '../engine/locate.cjs';
import { createMemoryFiles } from '../memory/store.js';
import { healthReport } from './health.js';

const { MINIMUM_NODE, supportedNode } = createRequire(import.meta.url)('../../hooks/node-support.cjs');

// `deltadictum doctor`: a failing hook ends silently (L5), so a person whose node
// is missing from the hooks' PATH, whose index never compiled or whose plugin is
// disabled sees nothing. One report says what is in place: the opt-in, the store,
// the index, the sessions recorded, maintenance, and the health signals that
// need a person. Problems need action; notes are information.
const STUCK_MS = 60 * 60 * 1000;
const item = (code, hint) => ({ code, hint });
const plural = (n, word) => `${n} ${n === 1 ? word : word.endsWith('y') ? `${word.slice(0, -1)}ies` : `${word}s`}`;
const day = at => (at ? String(at).slice(0, 10) : null);

function configInfo(dd) {
  const path = join(dd, 'config.json');
  if (!existsSync(path)) return { present: false, valid: true, auto_accept: true };
  try {
    const config = JSON.parse(readFileSync(path, 'utf8'));
    return { present: true, valid: true, auto_accept: autoAcceptEnabled(config) };
  } catch { return { present: true, valid: false, auto_accept: null }; }
}

function sessionsInfo(root) {
  const dir = localPaths(root).sessions;
  let names = [];
  try { names = readdirSync(dir).filter(name => name.endsWith('.jsonl')); } catch { return { files: 0, last_at: null }; }
  let last = 0;
  for (const name of names) { try { last = Math.max(last, statSync(join(dir, name)).mtimeMs); } catch { /* gone */ } }
  return { files: names.length, last_at: last ? new Date(last).toISOString() : null };
}

function maintenanceInfo(root) {
  try { return JSON.parse(readFileSync(join(localPaths(root).local, 'maintenance.json'), 'utf8')); } catch { return null; }
}

export async function doctorReport(root, { now = Date.now() } = {}) {
  const paths = localPaths(root);
  const problems = [];
  const notes = [];
  const node = { version: process.versions.node, minimum: MINIMUM_NODE, supported: supportedNode() };
  if (!node.supported) problems.push(item('node_unsupported', `DD needs Node.js ${MINIMUM_NODE} or later; on ${process.version} every hook ends silently.`));
  const optedIn = existsSync(paths.dd);
  const report = { ok: false, summary: '', node, project: { root, opted_in: optedIn, v1_store: existsSync(join(paths.dd, 'atoms')), config: configInfo(paths.dd) },
    git: repoFilesOf(root) !== null, memories: null, index: null, sessions: null, maintenance: null, signals: null, problems, notes };
  if (!optedIn) {
    // Nothing is read or created for a project that did not opt in.
    problems.push(item('not_opted_in', 'This project has no .dd/ folder, so DD records nothing and asks nothing here: run `deltadictum init` and commit .dd/.'));
    report.summary = 'DD: not opted in (no .dd/ folder): run `deltadictum init`.';
    return report;
  }
  if (report.project.v1_store) problems.push(item('v1_store', 'The .dd/ folder holds a v1 store (atoms/): run `deltadictum migrate` and commit the result.'));
  if (!report.project.config.valid) problems.push(item('config_invalid', '.dd/config.json is not valid JSON; DD reads its defaults until it is fixed.'));
  if (!report.git) notes.push(item('no_git', 'Not a git repository: dead triggers and stale evidence cannot be judged, and evidence files cannot be verified.'));

  const all = await createMemoryFiles(paths.dd).list();
  const count = status => all.filter(memory => memory.status === status).length;
  const health = await healthReport(root);
  report.memories = { live: count('active') + count('contested'), candidates: count('candidate'), superseded: count('superseded'), archived: count('archived'),
    unsupported: health.unsupported.length };
  const index = loadIndex(root);
  report.index = { present: Boolean(index), fresh: Boolean(index) && !needsCompile(index, root) };
  if (!index) problems.push(item('index_missing', 'No compiled index: hooks deliver nothing until a session starts here (it compiles) or `deltadictum compile` runs.'));
  else if (!report.index.fresh) problems.push(item('index_stale', 'The compiled index is older than the memories: the next session start rebuilds it, or run `deltadictum compile` now.'));
  report.sessions = { ...sessionsInfo(root), rolled_up: health.sessions };
  report.maintenance = maintenanceInfo(root);
  const withSignal = signal => health.memories.filter(memory => memory.signals.some(s => s.signal === signal)).length;
  report.signals = { dead_triggers: withSignal('dead_trigger'), stale_evidence: withSignal('stale_evidence'), hubs: withSignal('hub'),
    suspected_false_alarms: withSignal('suspected_false_alarm'), conflicts: health.conflicts.length, candidates: health.queues.candidates.length,
    auto_accepted: health.queues.auto_accepted.length, migrated_without_not_derivable: health.queues.migrated_without_not_derivable.length };

  if (health.unsupported.length) problems.push(item('unsupported_memory_files', `${plural(health.unsupported.length, 'memory file')} cannot be read (${health.unsupported.map(u => u.path).slice(0, 3).join(', ')}): fix or remove them; \`deltadictum health\` lists the reasons.`));
  if (health.conflicts.length) problems.push(item('topic_conflicts', `${plural(health.conflicts.length, 'topic')} with more than one live memory (${health.conflicts.map(c => c.topic).slice(0, 3).join(', ')}): archive or merge one in the review UI.`));
  if (report.signals.dead_triggers) problems.push(item('dead_triggers', `${plural(report.signals.dead_triggers, 'memory')} with a trigger that can never fire (a glob matching no file, a symbol absent from the code): fix them in the review UI's Dead triggers queue (/dd:review).`));
  if (report.signals.stale_evidence) problems.push(item('stale_evidence', `${plural(report.signals.stale_evidence, 'memory')} whose evidence file changed or is gone: re-verify them in the review UI's Stale evidence queue; deliveries carry a stale mark meanwhile.`));
  const started = Date.parse(report.maintenance?.started ?? '');
  if (report.maintenance?.state === 'started' && Number.isFinite(started) && now - started > STUCK_MS) {
    problems.push(item('maintenance_stuck', `The maintenance run started ${report.maintenance.started} and never finished: run \`deltadictum maintain\` by hand and read its error.`));
  }
  if (!report.sessions.files && !health.sessions) {
    notes.push(item('no_sessions_recorded', 'No session recorded yet: DD has not run in this project. If a Claude Code session already happened here, the plugin is not running: check that it is enabled and that `node` is on the PATH the hooks use.'));
  }
  if (!report.maintenance) notes.push(item('maintenance_never_ran', 'Maintenance has not run yet; a session start runs it once a day, `deltadictum maintain` runs it now.'));
  if (report.signals.candidates) notes.push(item('candidates_waiting', `${plural(report.signals.candidates, 'candidate')} wait for review (/dd:review).`));
  if (report.signals.auto_accepted) notes.push(item('auto_accepted_waiting', `${plural(report.signals.auto_accepted, 'memory')} DD accepted on its own wait for a person to mark them reviewed.`));
  if (report.signals.migrated_without_not_derivable) notes.push(item('migrated_without_not_derivable', `${plural(report.signals.migrated_without_not_derivable, 'migrated memory')} still need their not_derivable line.`));

  report.ok = problems.length === 0;
  const maintenance = !report.maintenance ? 'never ran' : report.maintenance.state === 'finished' ? `finished ${day(report.maintenance.finished)}` : `started ${day(report.maintenance.started)}`;
  const indexState = !index ? 'missing' : report.index.fresh ? 'fresh' : 'stale';
  const sessions = `${plural(report.sessions.files, 'session file')}${report.sessions.last_at ? ` (last ${day(report.sessions.last_at)})` : ''}`;
  report.summary = `${report.ok ? 'DD ok' : `DD: ${plural(problems.length, 'problem')}`}: ${plural(report.memories.live, 'live memory')}, index ${indexState}, ${sessions}, maintenance ${maintenance}`
    + `${problems.length ? `; ${problems.map(p => p.code).join(', ')}` : ''}.`;
  return report;
}
