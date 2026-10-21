// When DD's knowledge reached the agent, from a run's stream: before its first
// edit (in time to shape it), on that edit's own pre-tool event (after the agent
// decided the write: the limit the 2026-10-14 trial showed), or later.
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

// A delivered title is cut at its first " - "; a known title that holds one is matched whole instead.
function titlesIn(text, known) {
  const found = [...text.matchAll(DELIVERED)].map(m => m[1]);
  return found.map(title => known.find(k => k.startsWith(`${title} - `) && text.includes(`] ${k} - `)) ?? title);
}

export function deliveries(stream, known = []) {
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
    for (const title of titlesIn(contextOf(e), known)) {
      if (seen.has(title)) continue;
      seen.add(title);
      out.push({ title, at: phase, event: e.hook_event });
    }
  }
  return out;
}

// The tail joins titles with "; ": a known title holding one is taken whole first, longest first.
function tailTitles(tail, known) {
  const found = [];
  let rest = `; ${tail}; `;
  for (const title of [...known].filter(k => k.includes('; ')).sort((a, b) => b.length - a.length)) {
    const at = rest.indexOf(`; ${title}; `);
    if (at < 0) continue;
    found.push([at, title]);
    rest = `${rest.slice(0, at)};${' '.repeat(title.length + 1)}${rest.slice(at + title.length + 2)}`;
  }
  let at = 0;
  for (const part of rest.split(';')) {
    if (part.trim()) found.push([at, part.trim()]);
    at += part.length + 1;
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, title]) => title);
}

export function listed(stream, known = []) {
  const delivered = new Set(deliveries(stream, known).map(d => d.title));
  const titles = events(stream).flatMap(e => [...contextOf(e).matchAll(TAIL)].flatMap(m => tailTitles(m[1], known)));
  return [...new Set(titles)].filter(title => !delivered.has(title));
}
