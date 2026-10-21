// A recorded agent run as the bench replays it: each tool call as the hook's
// normalized event (spec section 3), and the lines it added per file. The
// committed fixture was built from the trial's runs with these; the layer-1
// bench extracts its traces with them too.
import { redactSecrets } from '../../engine/v2/sanitizer.js';
import { bashPaths, relativize, toolEvent as hookEvent } from '../../hooks/v2/events.cjs';

const TEXT_MAX = 2000;
const ADDED_MAX = 16000;
const clip = text => redactSecrets(String(text ?? '')).slice(0, TEXT_MAX);

export { bashPaths, relativize };

// The hook's event (src/hooks/v2/events.cjs), with its text clipped and redacted
// for a committed fixture; null for a tool that carries no project work.
export function toolEvent(name, input, cwd) {
  const event = hookEvent(name, input, cwd);
  return event && 'text' in event ? { ...event, text: clip(event.text) } : event;
}

export function streamEvents(stream) {
  const lines = String(stream ?? '').split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const cwd = lines.find(e => e.type === 'system' && e.subtype === 'init')?.cwd ?? '';
  return lines.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? [])
    .filter(part => part.type === 'tool_use').map(part => toolEvent(part.name, part.input ?? {}, cwd)).filter(Boolean);
}

// The lines a diff adds, per file, leaving out DD's own store.
export function addedByFile(diff) {
  const added = {};
  let file = null;
  for (const line of String(diff ?? '').split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) { file = header[2].startsWith('.dd/') ? null : header[2]; continue; }
    if (file && line.startsWith('+') && !line.startsWith('+++')) added[file] = `${added[file] ?? ''}${line.slice(1)}\n`;
  }
  return Object.fromEntries(Object.entries(added).map(([path, text]) => [path, redactSecrets(text).slice(0, ADDED_MAX)]));
}
