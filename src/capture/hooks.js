import { statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';
import { appendFootprint, correctionEntry, footprintPath, toolEntry } from './footprint.js';
import { stopRequest } from './stop.js';

const hasFootprint = path => { try { return statSync(path).size > 0; } catch { return false; } };

// The capture side of DD's hooks (spec section 7), loaded only for these commands.
export async function run(command, root, payload) {
  const path = footprintPath(root, payload.session_id);
  if (command === 'observe') {
    const entry = path ? toolEntry(payload, { root, claudeCode: process.env.CLAUDECODE === '1' }) : null;
    if (entry) appendFootprint(path, entry);
    return '';
  }
  if (command === 'observe-prompt') {
    // A correction is about something the agent did: before a session's first tool call or Stop there is
    // nothing, and "Do not change any code" in a first prompt is an instruction. An empty footprint is that.
    const entry = path && hasFootprint(path) ? correctionEntry(payload) : null;
    if (entry) appendFootprint(path, entry);
    return '';
  }
  if (command === 'stop') {
    // A turn DD made continue is checked too: a fix can break the rule elsewhere,
    // and the twice-per-file limit bounds the loop. It asks for no memory.
    const { turnViolations } = await import('../checks/turn.js');
    let violations = '';
    // A check that throws never costs the turn its capture request.
    try { violations = turnViolations(root, payload); } catch { /* fail open */ }
    // A check is knowledge too: the user may have asked for what it flags.
    if (violations) violations = `${violations}\n${(await import('../engine/deliver.cjs')).default.ON_CONFLICT}`;
    return [violations, stopRequest(root, payload)].filter(Boolean).join('\n\n');
  }
  if (command === 'inbox') {
    const raw = String(payload.tool_input?.file_path ?? '');
    const file = isAbsolute(raw) ? raw : join(payload.cwd || root, raw);
    // The agent was told DD answers in the same turn: a failure says so too.
    try {
      const { ingestInboxFile } = await import('./inbox.js');
      return (await ingestInboxFile({ root, file, sessionId: payload.session_id })).reply;
    } catch (err) {
      const reason = String(err?.code ?? err?.message ?? 'error').replace(/\s+/g, ' ').slice(0, 120);
      return `DD - .dd/inbox/${basename(file)} not stored (${reason}); write it again.`;
    }
  }
  return '';
}
