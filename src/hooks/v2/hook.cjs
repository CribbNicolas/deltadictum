'use strict';

const { existsSync } = require('node:fs');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadIndex, needsCompile, readBodies } = require('../../engine/index-file.cjs');
const { findProjectRoot, localPaths } = require('../../engine/locate.cjs');
const { matchEvent, prepareIndex } = require('../../engine/match.cjs');
const { toolEvent } = require('./events.cjs');

// What a Claude Code hook does in v2 (spec section 5): nothing at session start
// but bookkeeping, memories at the prompt and at tool calls, once per epoch per
// session and subagent. Modules a quiet event does not need load lazily.
const EVENT_NAMES = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', 'pre-tool': 'PreToolUse' };

function respond(command, text) {
  return text ? JSON.stringify({ hookSpecificOutput: { hookEventName: EVENT_NAMES[command], additionalContext: text } }) : '';
}

function deliverFor(root, event, session) {
  const index = event ? loadIndex(root) : null;
  const fired = index ? matchEvent(prepareIndex(index), event) : [];
  if (!fired.length) return '';
  const { ledgerPath, openLedger } = require('../../engine/ledger.cjs');
  const { renderDelivery, staleEvidence } = require('../../engine/deliver.cjs');
  const path = session ? ledgerPath(localPaths(root).sessions, session.id, session.agent) : null;
  const won = path ? new Set(openLedger(path).claim(fired.map(hit => hit.id))) : new Set(fired.map(hit => hit.id));
  const items = fired.filter(hit => won.has(hit.id));
  if (!items.length) return '';
  const bodies = readBodies(root) ?? {};
  return renderDelivery({ label: (event.paths ?? []).join(', ') || event.kind, items: items.map(hit => ({ id: hit.id,
    ...index.memories[hit.id], body: bodies[hit.id]?.body ?? '', stale: staleEvidence(root, bodies[hit.id]?.evidence) })) });
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
  if (needsCompile(loadIndex(root), root)) {
    const { compileProject } = await import(pathToFileURL(join(__dirname, '..', '..', 'engine', 'compile.js')).href);
    await compileProject(root);
  }
  return '';
}

async function handle(command, payload) {
  if (!EVENT_NAMES[command] || !payload || typeof payload !== 'object') return '';
  const root = findProjectRoot(payload.cwd || process.cwd());
  const session = payload.session_id ? { id: payload.session_id, agent: payload.agent_id } : null;
  if (command === 'session-start') return respond(command, await sessionStart(root, payload, session));
  const event = command === 'prompt'
    ? { kind: 'prompt', paths: [], text: String(payload.prompt ?? '') }
    : toolEvent(payload.tool_name, payload.tool_input ?? {}, root);
  return respond(command, deliverFor(root, event, session));
}

module.exports = { handle, deliverFor, respond };
