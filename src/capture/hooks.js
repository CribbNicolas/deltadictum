import { appendFootprint, correctionEntry, footprintPath, toolEntry } from './footprint.js';
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
  if (command === 'stop') return stopRequest(root, payload);
  return '';
}
