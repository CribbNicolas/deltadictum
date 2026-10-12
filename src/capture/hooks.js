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
    // A Stop that DD already made the agent continue says nothing more: no loops.
    if (payload.stop_hook_active) return '';
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
