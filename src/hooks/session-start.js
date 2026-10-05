import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { INSTALL_LOG, manualInstallCommand } from '../deps.js';
import { sessionBanner, uiPointer } from './banner.js';
import { orientProject } from '../engine/project-context.js';
import { AMBIENT_TAG, ambientRevision, whenLine } from '../engine/retrieve.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';
import { AUTHORITY_WEIGHT } from '../engine/ranking.js';
import { estimateTokens } from '../engine/budget.js';
import { revisionNotices } from '../engine/revisions.js';
import { looksNonEnglish, substantive } from '../engine/language.js';

// Memories a reviewer tagged `ambient` apply to nearly every task (architecture,
// project-wide conventions), which no single tool call names. They are sent once
// per session here instead, in micro form, and marked delivered so the
// PreToolUse path does not repeat them. Stale evidence leaves one to that path,
// which flags it.
const AMBIENT_BUDGET = 150;
async function ambientMemories({ store, projectId, sessionId }) {
  const atoms = (await store.listAtoms({ projectId, lifecycleStates: ['active'] }))
    .filter(atom => (atom.tags ?? []).includes(AMBIENT_TAG) && atom.authority !== 'deprecated')
    .sort((a, b) => (AUTHORITY_WEIGHT[b.authority] ?? 0) - (AUTHORITY_WEIGHT[a.authority] ?? 0)
      || Number(b.confidence ?? 0) - Number(a.confidence ?? 0) || a.id.localeCompare(b.id));
  const picked = [];
  for (const atom of atoms) {
    if (sessionId && store.wasDelivered && await store.wasDelivered(projectId, sessionId, atom.id, ambientRevision(atom))) continue;
    if ((await checkEvidenceFreshness(atom, store)).length) continue;
    const memory = { id: atom.id, memory_type: atom.memory_type, content: atom.retrieval_forms?.micro ?? atom.behavior_delta };
    if (estimateTokens(microPack([...picked, memory])) > AMBIENT_BUDGET) continue;
    picked.push(memory);
    if (sessionId && store.markDelivered) await store.markDelivered(projectId, sessionId, atom.id, ambientRevision(atom));
  }
  return picked;
}

// A sentinel id in the same session_deliveries table used for individual memory
// atoms: it lets a reconnect that already has the project-context advisory in its
// transcript skip resending it, using the exact mechanism already trusted for
// per-atom dedup, rather than guessing at a harness-specific `source` value for
// "this is a reconnect, not a new session".
const SESSION_CONTEXT_ATOM_ID = '__session_context__';

// Hooks push what matches the prompt or the tool call; seen in a Claude Code
// session (2026-09-23/24), that push made pulling look redundant, and the model
// never called retrieve or propose unasked. Claude Code also defers MCP tools
// to names only, so the line says they may need loading first.
export const PULL_GUIDANCE = 'DD - Pushed knowledge covers what an anchor or similarity matched in the prompt or tool call. The memory map '
  + 'below lists every memory: before acting on anything a line covers, call the dd `get` tool with its topic_key and this session_id. When a request in '
  + 'another language brings nothing, call `retrieve` with the task described in English. Call `propose` '
  + 'when you learn something an agent reading the code would miss. If the dd tools are listed by name only, load them first.';

// The map is the one delivery every host supports (session context), and the
// agent reading it matches meaning and language far better than any threshold.
// Over budget it groups by domain rather than dropping a memory.
export const MAP_BUDGET = 5000;
const MAP_LINE_CHARS = 100;
export function memoryMap(atoms, { budget = MAP_BUDGET } = {}) {
  const sorted = [...atoms].sort((a, b) => a.topic_key.localeCompare(b.topic_key));
  // A line says when the memory applies, as a skill's description does: the agent
  // decides from it whether to pull the memory, and a title rarely says when.
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

// Near misses the agent may pull: one line each, after the pushed memories.
export function pointerPack(pointers) {
  if (!pointers?.length) return null;
  return ['DD - Possibly relevant, not pushed (call the dd `get` tool with the topic_key if one applies):',
    ...pointers.map(p => `- ${p.line}`)].join('\n');
}

// A request not in English reaches memories written in English poorly: neither
// full text nor e5-small bridges "adaptadores de los harnesses" to "OpenCode
// adapter". The agent restates it; said next to the request, where it is acted on.
export const RETRIEVE_NUDGE = 'DD - This request is not in English and DD matches memories written in English: '
  + 'call the dd `retrieve` tool with the task described in English before acting.';

// What a prompt hook adds to the conversation: the pushed pack, its pointers and,
// for a request in another language, the nudge to retrieve it in English.
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

export function contextPayload(eventName, text) {
  if (!text) return {};
  const body = String(text).startsWith('DD - ') ? text : `DD - ${text}`;
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext: body,
    },
  };
}

// What the person should know about the resident process (L2), relayed by the
// model: whether this session has semantic retrieval, and how to fix it if not.
// Embeddings are required (2026-09-23): without a ready resident process DD is
// inactive, and the person is told why and how to fix it. DD_RETRIEVAL=lexical
// is the explicit opt-in for tests and evaluation.
export const lexicalMode = () => process.env.DD_RETRIEVAL === 'lexical';
export function isInactive(resident) {
  // Every hook path states the resident; a caller that states nothing (tests,
  // single-project tools) is not asserting that DD is inactive.
  if (lexicalMode() || !resident) return false;
  const { state, retrieval } = resident;
  return state !== 'live' || retrieval === 'loading' || retrieval === 'unavailable';
}
export function residentNotice(resident = {}) {
  if (!isInactive(resident)) return null;
  const { state, retrieval } = resident;
  const fix = 'If this repeats, see README > "Troubleshooting".';
  const tell = 'Tell the user this once.';
  if (state === 'live' && retrieval === 'loading') return `DD - Inactive for now: the resident DD process is loading its embedding model (the first run downloads about 130 MB). DD activates by itself once it is ready. ${tell}`;
  if (state === 'live') return `DD - Inactive: the resident DD process could not load its embedding model, which DD requires. ${fix} ${tell}`;
  if (state === 'installing') return resident.failed
    ? `DD - Inactive: installing DD's packages failed (${resident.failed}); another attempt is running in the background, logged in ${join(resident.root, INSTALL_LOG)}. To install them by hand: ${manualInstallCommand(resident.root)}. ${tell}`
    : `DD - Inactive for now: DD is installing its packages in the background (first run after installing or updating the plugin; it can take a few minutes). DD activates at a later session once they are in place. ${tell}`;
  if (state === 'started') return `DD - Inactive for now: no resident DD process was running, so one was started in the background. DD activates once its embedding model is ready. ${fix} ${tell}`;
  if (state === 'unreachable') return `DD - Inactive: the resident DD process is not answering, so nothing is recalled. A later prompt or session start replaces it if it stays down. ${fix} ${tell}`;
  if (state === 'superseded') return `DD - Inactive: the resident DD process on this machine is version ${resident.version}, newer than this install, and serves only that version. Update this DD install to ${resident.version}. ${tell}`;
  if (state === 'disabled') return `DD - Inactive: the resident DD process is disabled (DD_RESIDENT=0), and DD requires it. ${tell}`;
  return `DD - Inactive: the resident DD process could not be started, and DD requires it. ${fix} ${tell}`;
}

export async function buildSessionStartContext({ store, projectId, uiUrl, uiLive = false, sessionId, source, resident }) {
  if (sessionId && ['compact', 'clear'].includes(source)) await store.clearSessionDeliveries(projectId, sessionId);
  const activeCount = await store.countAtoms({ projectId, lifecycleStates: ['active'] });
  const banner = sessionBanner({ projectId, url: uiUrl, activeCount });

  // Inactive: the banner and the reason only. No project context or knowledge.
  if (isInactive(resident)) return {
    ...(uiLive && uiUrl ? { systemMessage: uiPointer(uiUrl) } : {}),
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: [banner, residentNotice(resident)].join('\n\n') },
  };

  const context = await orientProject({ budget_tokens: 400 }, { store, projectId });
  const revision = createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0, 16);
  // Falls back to "send it" on any telemetry error or on a harness that issues a
  // fresh session_id per reconnect (or none at all) — the check is then always a
  // miss, so behavior is identical to sending the full blob every time, as before.
  let alreadyPrimed = false;
  if (sessionId && store.wasDelivered) {
    try { alreadyPrimed = await store.wasDelivered(projectId, sessionId, SESSION_CONTEXT_ATOM_ID, revision); }
    catch { alreadyPrimed = false; }
  }
  if (sessionId && store.markDelivered) {
    try { await store.markDelivered(projectId, sessionId, SESSION_CONTEXT_ATOM_ID, revision); }
    catch { /* best-effort: a missed mark just means the next reconnect resends */ }
  }
  const ambient = await ambientMemories({ store, projectId, sessionId }).catch(() => []);
  const revisions = await revisionNotices({ store, projectId, sessionId }).catch(() => null);
  const knowledge = ambient.length ? `DD - Project-wide knowledge (advisory):
${microPack(ambient)}` : null;
  // Past the threshold, the archive is worth a person's cleanup; said once per session.
  const archiveAt = (await store.loadConfig()).archive_review_at;
  const archivedCount = alreadyPrimed ? 0 : await store.countAtoms({ projectId, lifecycleStates: ['archived'] });
  const archiveNote = archivedCount > archiveAt
    ? `DD - The archive holds ${archivedCount} memories (review at ${archiveAt}). Offer the user /dd:clean to restore what is still useful and delete the rest.`
    : null;
  const live = alreadyPrimed || !activeCount ? [] : await store.listAtoms({ projectId, lifecycleStates: ['active', 'contested'] }).catch(() => []);
  const map = live.length ? memoryMap(live) : null;
  const advisory = alreadyPrimed ? null
    : `DD - Project context (advisory): ${JSON.stringify({ ...context, ...(sessionId ? { session_id: sessionId } : {}) })}`;
  return {
    // `additionalContext` is for the model; `systemMessage` is the line the
    // person sees. The URL only goes in front of them once something answered
    // on it, so the link they click is a link that opens.
    ...(uiLive && uiUrl ? { systemMessage: uiPointer(uiUrl) } : {}),
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [banner, residentNotice(resident), alreadyPrimed ? null : PULL_GUIDANCE, revisions, archiveNote, advisory, map, knowledge]
        .filter(Boolean).join('\n\n'),
    },
  };
}
