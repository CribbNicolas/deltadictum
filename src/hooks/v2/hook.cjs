'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { findProjectRoot, localPaths } = require('../../engine/locate.cjs');

// What a Claude Code hook does in v2 (spec section 5): nothing at session start
// but bookkeeping, memories at the prompt and at tool calls, once per epoch per
// session and subagent. Modules a quiet event does not need load lazily, and a
// project without a compiled index loads none of the matching code.
const EVENT_NAMES = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', 'pre-tool': 'PreToolUse', stop: 'Stop', inbox: 'PostToolUse' };
// Capture (spec section 7) is ES modules off the PreToolUse path, loaded only for these.
const CAPTURE = ['observe', 'observe-prompt', 'stop', 'inbox'];

// Codex takes Stop's message as a block with the reason (spec section 5), as v1 did.
function respond(command, text, host = 'claude') {
  if (!text) return '';
  if (host === 'codex' && command === 'stop') return JSON.stringify({ decision: 'block', reason: text });
  return JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT_NAMES[command], additionalContext: text } });
}
const INBOX_FILE = /^\.dd\/inbox\/[^/]+\.json$/i;

// What the delivery is about: the event's first paths, never a list that fills the field.
const LABEL_PATHS = 3;
function labelFor(event) {
  const paths = event.paths ?? [];
  if (!paths.length) return event.kind;
  const shown = paths.slice(0, LABEL_PATHS).map(path => String(path).slice(0, 200)).join(', ');
  return paths.length > LABEL_PATHS ? `${shown} and ${paths.length - LABEL_PATHS} more` : shown;
}

// Memories that fire at this event and checks that speak at it (spec sections 3 and 6).
function deliverFor(root, event, session, payload = {}) {
  const { loadIndex, readBodies } = require('../../engine/index-file.cjs');
  const index = event ? loadIndex(root) : null;
  if (!index) return '';
  const { matchEvent, prepareIndex } = require('../../engine/match.cjs');
  const fired = matchEvent(prepareIndex(index), event);
  const checks = applicableChecks(index, event);
  if (!fired.length && !checks.length) return '';
  const { ledgerPath, openLedger } = require('../../engine/ledger.cjs');
  const ledger = session ? openLedger(ledgerPath(localPaths(root).sessions, session.id, session.agent)) : null;
  let bodies;
  const bodiesOf = () => (bodies === undefined ? (bodies = readBodies(root, index)) : bodies);
  // Checks speak first: a violation the call is about to introduce comes before
  // knowledge about its files, and both share the 10,000-character field.
  const violations = checks.length ? require('../../checks/tool.cjs').toolViolations({ root, index, event, payload, ledger, checks, bodiesOf }).join('\n') : '';
  const parts = [violations];
  // Never a headline (spec section 2): without its body a memory is neither delivered nor claimed.
  if (fired.length && bodiesOf()) {
    const { LIMIT } = require('../../engine/deliver.cjs');
    parts.push(delivery(root, index, event, fired, ledger, bodiesOf(), violations ? LIMIT - violations.length - 2 : LIMIT));
  }
  return parts.filter(Boolean).join('\n\n');
}

// The checks this tool call evaluates: command checks for a run, `when: edit`
// checks whose paths cover the file for an edit or write. Turn checks wait for
// Stop; nothing else loads the check machinery.
function applicableChecks(index, event) {
  const checks = (index.checks ?? []).filter(check => check.on.includes(event.kind) && check.when === (event.kind === 'run' ? 'run' : 'edit'));
  if (!checks.length || event.kind === 'run') return checks;
  const { PATH_FLAGS } = require('../../engine/clause.cjs');
  const target = event.paths?.[0];
  return target ? checks.filter(check => (check.paths ?? []).some(source => new RegExp(source, PATH_FLAGS).test(target))) : [];
}

function delivery(root, index, event, fired, ledger, bodies, limit) {
  const { fitItems, renderDelivery, staleEvidence } = require('../../engine/deliver.cjs');
  const done = ledger ? ledger.delivered() : new Set();
  const fresh = fired.filter(hit => !done.has(hit.id) && typeof bodies[hit.id]?.body === 'string');
  if (!fresh.length) return '';
  const label = labelFor(event);
  const candidates = fresh.map(hit => ({ id: hit.id, ...index.memories[hit.id], body: bodies[hit.id]?.body ?? '',
    stale: staleEvidence(root, bodies[hit.id]?.evidence) }));
  // Only what fits whole is claimed; the rest is named and arrives at its next event.
  const fits = fitItems({ label, items: candidates, limit });
  const claims = { kind: event.kind, viaOf: id => fired.find(hit => hit.id === id)?.via };
  const won = ledger ? new Set(ledger.claim(fits.map(item => item.id), claims)) : new Set(fits.map(item => item.id));
  const items = fits.filter(item => won.has(item.id));
  const named = candidates.filter(item => !fits.includes(item));
  if (!items.length && !named.length) return '';
  return renderDelivery({ label, items, named, limit });
}

// Session start injects nothing (spec section 1): it re-arms the ledger after a
// compaction or /clear, starts the daily maintenance (which prunes old session
// files), and compiles a missing or stale index so the first tool call is
// served. A project without a .dd/ folder is left alone: the folder (a
// committed .dd/config.json, or the memories themselves) is the opt-in.
async function sessionStart(root, payload, session) {
  const paths = localPaths(root);
  if (!existsSync(paths.dd)) return '';
  const { ledgerPath, openLedger } = require('../../engine/ledger.cjs');
  if (session && ['compact', 'clear'].includes(payload.source)) openLedger(ledgerPath(paths.sessions, session.id, session.agent)).newEpoch(payload.source);
  // Maintenance (roll-up, then pruning) runs detached at most once a day; session
  // start never waits for it.
  const { maintenanceDue } = require('../../maintenance/due.cjs');
  // DD_MAINTENANCE=0 turns it off (tests, CI).
  if (process.env.DD_MAINTENANCE !== '0' && maintenanceDue(root)) {
    try {
      const { spawn } = require('node:child_process');
      spawn(process.execPath, [join(__dirname, '..', '..', 'cli.js'), 'maintain'], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } catch { /* maintenance is best effort */ }
  }
  const { loadIndex, needsCompile } = require('../../engine/index-file.cjs');
  if (needsCompile(loadIndex(root), root)) {
    const { compileProject } = await import(pathToFileURL(join(__dirname, '..', '..', 'engine', 'compile.js')).href);
    await compileProject(root);
  }
  return '';
}

async function handle(command, payload, { host = 'claude' } = {}) {
  if (!(EVENT_NAMES[command] || CAPTURE.includes(command)) || !payload || typeof payload !== 'object') return '';
  if (host === 'codex') payload = require('./codex.cjs').codexPayload(payload);
  const root = findProjectRoot(payload.cwd || process.cwd());
  if (CAPTURE.includes(command)) {
    const capturePath = pathToFileURL(join(__dirname, '..', '..', 'capture', 'hooks.js')).href;
    // The inbox hook runs after every write; only a JSON file in .dd/inbox/ loads
    // capture, and it may create the project's first memory. A patch may add several.
    if (command === 'inbox') {
      const event = require('./events.cjs').toolEvent(payload.tool_name, payload.tool_input ?? {}, root, payload.cwd || root);
      const files = (event?.paths ?? []).filter(path => INBOX_FILE.test(path));
      if (!files.length) return '';
      const capture = await import(capturePath);
      const replies = [];
      for (const file of files) replies.push(await capture.run(command, root, { ...payload, tool_input: { file_path: join(root, file) } }));
      return respond(command, replies.filter(Boolean).join('\n'), host);
    }
    // Footprint, corrections and Stop requests belong to a project that opted in,
    // from its first session on: a memory is not needed for DD to ask for one.
    if (!existsSync(localPaths(root).dd)) return '';
    const capture = await import(capturePath);
    return respond(command, await capture.run(command, root, payload), host);
  }
  const session = payload.session_id ? { id: payload.session_id, agent: payload.agent_id } : null;
  if (command === 'session-start') return respond(command, await sessionStart(root, payload, session), host);
  if (!existsSync(localPaths(root).index)) return '';
  const event = command === 'prompt'
    ? { kind: 'prompt', paths: [], text: String(payload.prompt ?? '') }
    : require('./events.cjs').toolEvent(payload.tool_name, payload.tool_input ?? {}, root, payload.cwd || root);
  return respond(command, deliverFor(root, event, session, payload), host);
}

module.exports = { handle, deliverFor, respond };
