import { isAbsolute, join } from 'node:path';
import { appendFootprint, correctionEntry, footprintPath, toolEntry } from './footprint.js';
import { ingestInboxFile } from './inbox.js';
import { stopRequest } from './stop.js';

// The capture side of DD's hooks (spec section 7), loaded only for these commands.
export async function run(command, root, payload) {
  const path = footprintPath(root, payload.session_id);
  if (command === 'observe') {
    const entry = path ? toolEntry(payload, { root, claudeCode: process.env.CLAUDECODE === '1' }) : null;
    if (entry) appendFootprint(path, entry);
    return '';
  }
  if (command === 'observe-prompt') {
    const entry = path ? correctionEntry(payload) : null;
    if (entry) appendFootprint(path, entry);
    return '';
  }
  if (command === 'stop') {
    // A turn DD made continue is checked too: a fix can break the rule elsewhere,
    // and the twice-per-file limit bounds the loop. It asks for no memory.
    const { turnViolations } = await import('../checks/turn.js');
    return [turnViolations(root, payload), stopRequest(root, payload)].filter(Boolean).join('\n\n');
  }
  if (command === 'inbox') {
    const raw = String(payload.tool_input?.file_path ?? '');
    const file = isAbsolute(raw) ? raw : join(payload.cwd || root, raw);
    return (await ingestInboxFile({ root, file, sessionId: payload.session_id })).reply;
  }
  return '';
}
