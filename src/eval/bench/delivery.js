// When DD's knowledge reached the agent, from a run's stream: before its first
// edit (in time to shape it), on that edit's own pre-tool event (after the agent
// decided the write: the limit the v2 trial showed), or later.
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// src/engine/deliver.cjs: "[KIND] title - body", " [DISPUTED]" after the kind,
// and a tail "... and N more: a; b" naming memories it did not deliver.
const DELIVERED = /^\[(?:TRAP|DECISION|FACT|ABANDONED|PROCEDURE)\](?: \[DISPUTED\])? (.+?) - /gm;
const TAIL = /^\.\.\. and \d+ more: (.+)$/gm;

function events(stream) {
  return String(stream ?? '').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
}

function contextOf(event) {
  if (event.type !== 'system' || event.subtype !== 'hook_response') return '';
  try { return JSON.parse(event.stdout || '{}').hookSpecificOutput?.additionalContext ?? ''; } catch { return ''; }
}

const hasPart = (event, type, match) => (event.message?.content ?? []).some(part => part.type === type && match(part));

export function deliveries(stream) {
  const all = events(stream);
  let editId = null;
  for (const e of all) {
    const call = e.type === 'assistant' ? (e.message?.content ?? []).find(c => c.type === 'tool_use' && EDITS.has(c.name)) : null;
    if (call) { editId = call.id; break; }
  }
  let phase = editId ? 'before_edit' : 'no_edit';
  const out = [], seen = new Set();
  for (const e of all) {
    if (editId && e.type === 'assistant' && hasPart(e, 'tool_use', c => c.id === editId)) phase = 'at_edit';
    if (phase === 'at_edit' && e.type === 'user' && hasPart(e, 'tool_result', c => c.tool_use_id === editId)) phase = 'after_edit';
    for (const m of contextOf(e).matchAll(DELIVERED)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push({ title: m[1], at: phase, event: e.hook_event });
    }
  }
  return out;
}

export function listed(stream) {
  const delivered = new Set(deliveries(stream).map(d => d.title));
  const titles = events(stream).flatMap(e => [...contextOf(e).matchAll(TAIL)].flatMap(m => m[1].split('; ')));
  return [...new Set(titles)].filter(title => !delivered.has(title));
}
