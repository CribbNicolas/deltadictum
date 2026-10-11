import { whenLine } from '../../engine/retrieve.js';
import { estimateTokens } from '../../engine/budget.js';
import { looksNonEnglish, substantive } from '../../engine/language.js';

// The v1 delivery text, kept for the v1 retrieval benchmark and its tests after
// the v1 hooks were removed (v2 plan 3). It goes with the v1 engine in plan 6.

export const PULL_GUIDANCE = 'DD - Pushed knowledge covers what an anchor or similarity matched in the prompt or tool call. The memory map '
  + 'below lists every memory: before acting on anything a line covers, call the dd `get` tool with its topic_key and this session_id. When a request in '
  + 'another language brings nothing, call `retrieve` with the task described in English. Call `propose` '
  + 'when you learn something an agent reading the code would miss. If the dd tools are listed by name only, load them first.';

// Over budget the map groups by domain rather than dropping a memory.
export const MAP_BUDGET = 5000;
const MAP_LINE_CHARS = 100;
export function memoryMap(atoms, { budget = MAP_BUDGET } = {}) {
  const sorted = [...atoms].sort((a, b) => a.topic_key.localeCompare(b.topic_key));
  const lines = sorted.map(a => `${a.topic_key} — ${whenLine(a, MAP_LINE_CHARS)}`);
  const flat = [`DD - Memory map (${sorted.length}):`, ...lines].join('\n');
  if (estimateTokens(flat) <= budget) return flat;
  const domains = new Map();
  for (const atom of sorted) {
    const [domain, ...rest] = atom.topic_key.split('/');
    domains.set(domain, [...(domains.get(domain) ?? []), rest.join('/')]);
  }
  const grouped = [...domains].map(([domain, topics]) => `${domain} (${topics.length}): ${topics.join(', ')}`);
  return [`DD - Memory map (${sorted.length}, by domain):`, ...grouped].join('\n');
}

export function pointerPack(pointers) {
  if (!pointers?.length) return null;
  return ['DD - Possibly relevant, not pushed (call the dd `get` tool with the topic_key if one applies):',
    ...pointers.map(p => `- ${p.line}`)].join('\n');
}

export const RETRIEVE_NUDGE = 'DD - This request is not in English and DD matches memories written in English: '
  + 'call the dd `retrieve` tool with the task described in English before acting.';

export function promptPack(result, prompt) {
  const nudge = looksNonEnglish(prompt) && substantive(prompt, 2) ? RETRIEVE_NUDGE : null;
  return [microPack(result.memories ?? []), pointerPack(result.pointers), nudge].filter(Boolean).join('\n');
}

export function microPack(memories) {
  return memories.map(memory => {
    const flag = memory.contested || memory.lifecycle_state === 'contested' ? 'DISPUTED'
      : memory.lifecycle_state === 'legacy' ? 'LEGACY'
      : memory.lifecycle_state === 'review_required' ? 'REVIEW REQUIRED'
      : memory.memory_type === 'anti_memory' ? 'ANTI' : memory.memory_type.toUpperCase();
    return `[${flag} ${memory.id ?? ''}] ${memory.content || memory.retrieval_forms?.micro || memory.title}`;
  }).join('\n');
}

// Host tools that load skills, find tools, report on subagents, wait or ask carry
// no project work; on the golden sets, retrieving on them only added noise.
const HOST_META_TOOLS = new Set(['Skill', 'ToolSearch', 'SubagentHandback', 'Monitor', 'TaskStop', 'TaskOutput',
  'AskUserQuestion', 'ScheduleWakeup', 'SendMessage', 'ListAgents', 'EnterPlanMode', 'ExitPlanMode', 'TodoWrite',
  'WebSearch', 'WebFetch']);

// The retrieval request a tool call became in the v1 PreToolUse hook.
export function preToolRequest(payload) {
  const tool = String(payload.toolName || payload.tool_name || '');
  if (!tool || /(^|__)(dd|deltadictum)(__|_)/i.test(tool) || HOST_META_TOOLS.has(tool)) return null;

  const input = payload.toolInput ?? payload.tool_input ?? {};
  const serialized = typeof input === 'string' ? input : JSON.stringify(input);
  const action = `${tool} ${serialized}`.slice(0, 800);
  const files = typeof input === 'object' && input !== null ? [input.file_path, input.path, input.filename, ...(Array.isArray(input.files) ? input.files : [])]
    .filter(v => typeof v === 'string') : [];
  if (/apply_patch/i.test(tool)) {
    const patch = typeof input === 'string' ? input : input.command ?? input.patch ?? '';
    for (const match of patch.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) files.push(match[1].trim());
  }
  const operation = /edit|write|replace|patch/i.test(tool) ? 'edit' : /read|search|grep/i.test(tool) ? 'read'
    : /\b(test|pytest|jest|vitest)\b/i.test(serialized) ? 'test'
    : /\b(deploy|deployment)\b/i.test(serialized) ? 'deploy' : undefined;
  return { action, files, operation, source: 'tool' };
}

export function preToolPack(result) {
  const pack = microPack(result.memories ?? []);
  return [pack ? `DD - Project knowledge (advisory):\n${pack}` : null, pointerPack(result.pointers)].filter(Boolean).join('\n');
}
