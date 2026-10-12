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

function respond(command, text) {
  return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT_NAMES[command], additionalContext: text } }) : '';
}

// What the delivery is about: the event's first paths, never a list that fills the field.
const LABEL_PATHS = 3;
function labelFor(event) {
  const paths = event.paths ?? [];
  if (!paths.length) return event.kind;
  const shown = paths.slice(0, LABEL_PATHS).map(path => String(path).slice(0, 200)).join(', ');
  return paths.length > LABEL_PATHS ? `${shown} and ${paths.length - LABEL_PATHS} more` : shown;
}

function deliverFor(root, event, session) {
  const { loadIndex, readBodies } = require('../../engine/index-file.cjs');
  const { matchEvent, prepareIndex } = require('../../engine/match.cjs');
  const index = event ? loadIndex(root) : null;
  const fired = index ? matchEvent(prepareIndex(index), event) : [];
  if (!fired.length) return '';
  const { ledgerPath, openLedger } = require('../../engine/ledger.cjs');
  const { fitItems, renderDelivery, staleEvidence } = require('../../engine/deliver.cjs');
  const ledger = session ? openLedger(ledgerPath(localPaths(root).sessions, session.id, session.agent)) : null;
  const done = ledger ? ledger.delivered() : new Set();
  // Never a headline (spec section 2): without its body a memory is neither delivered nor claimed.
  const bodies = readBodies(root, index);
  if (!bodies) return '';
  const fresh = fired.filter(hit => !done.has(hit.id) && typeof bodies[hit.id]?.body === 'string');
  if (!fresh.length) return '';
  const label = labelFor(event);
  const candidates = fresh.map(hit => ({ id: hit.id, ...index.memories[hit.id], body: bodies[hit.id]?.body ?? '',
    stale: staleEvidence(root, bodies[hit.id]?.evidence) }));
  // Only what fits whole is claimed; the rest is named and arrives at its next event.
  const fits = fitItems({ label, items: candidates });
  const won = ledger ? new Set(ledger.claim(fits.map(item => item.id))) : new Set(fits.map(item => item.id));
  const items = fits.filter(item => won.has(item.id));
  const named = candidates.filter(item => !fits.includes(item));
  if (!items.length && !named.length) return '';
  return renderDelivery({ label, items, named });
}

// Session start injects nothing (spec section 1): it re-arms the ledger after a
// compaction or /clear, prunes old ledgers, and compiles a missing or stale index
// so the first tool call is served. A project without DD memories is left alone.
async function sessionStart(root, payload, session) {
  const paths = localPaths(root);
  if (!existsSync(paths.memories)) return '';
  const { ledgerPath, openLedger, pruneSessions } = require('../../engine/ledger.cjs');
  if (session && ['compact', 'clear'].includes(payload.source)) openLedger(ledgerPath(paths.sessions, session.id, session.agent)).newEpoch(payload.source);
  pruneSessions(paths.sessions);
  const { loadIndex, needsCompile } = require('../../engine/index-file.cjs');
  if (needsCompile(loadIndex(root), root)) {
    const { compileProject } = await import(pathToFileURL(join(__dirname, '..', '..', 'engine', 'compile.js')).href);
    await compileProject(root);
  }
  return '';
}

async function handle(command, payload) {
  if (!(EVENT_NAMES[command] || CAPTURE.includes(command)) || !payload || typeof payload !== 'object') return '';
  const root = findProjectRoot(payload.cwd || process.cwd());
  if (CAPTURE.includes(command)) {
    // The inbox hook runs after every write; only a JSON file in .dd/inbox/ loads
    // capture, and it may create the project's first memory.
    if (command === 'inbox') {
      const file = String(payload.tool_input?.file_path ?? '');
      if (!/^\.dd\/inbox\/[^/]+\.json$/i.test(require('./events.cjs').relativize(file, root))) return '';
    } else if (!existsSync(localPaths(root).memories)) return '';
    const capture = await import(pathToFileURL(join(__dirname, '..', '..', 'capture', 'hooks.js')).href);
    return respond(command, await capture.run(command, root, payload));
  }
  const session = payload.session_id ? { id: payload.session_id, agent: payload.agent_id } : null;
  if (command === 'session-start') return respond(command, await sessionStart(root, payload, session));
  if (!existsSync(localPaths(root).index)) return '';
  const event = command === 'prompt'
    ? { kind: 'prompt', paths: [], text: String(payload.prompt ?? '') }
    : require('./events.cjs').toolEvent(payload.tool_name, payload.tool_input ?? {}, root, payload.cwd || root);
  return respond(command, deliverFor(root, event, session));
}

module.exports = { handle, deliverFor, respond };
