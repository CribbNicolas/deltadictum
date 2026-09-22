import { createHash } from 'node:crypto';
import { sessionBanner, uiPointer } from './banner.js';
import { orientProject } from '../engine/project-context.js';
import { AMBIENT_TAG, ambientRevision } from '../engine/retrieve.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';
import { AUTHORITY_WEIGHT } from '../engine/ranking.js';
import { estimateTokens } from '../engine/budget.js';

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

export function microPack(memories) {
  return memories.map(memory => {
    const flag = memory.contested || memory.lifecycle_state === 'contested' ? 'DISPUTED'
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
export function residentNotice({ state, retrieval } = {}) {
  const fix = 'If this repeats every session, see README > "Resident process".';
  if (state === 'started') return `DD - Retrieval is lexical for now: no resident DD process was serving this project, so one was started in the background. Semantic retrieval takes over once its model loads (the first run downloads about 130 MB). ${fix} Tell the user this once.`;
  if (state === 'unavailable') return `DD - Retrieval is lexical: the resident DD process could not be started. ${fix} Tell the user this once.`;
  if (retrieval === 'lexical') return `DD - Retrieval is lexical: the resident DD process runs without the optional embedding runtime (@huggingface/transformers). Reinstall DD with optional dependencies to enable semantic retrieval. ${fix} Tell the user this once.`;
  return null;
}

export async function buildSessionStartContext({ store, projectId, uiUrl, uiLive = false, sessionId, source, resident }) {
  if (sessionId && ['compact', 'clear'].includes(source)) await store.clearSessionDeliveries(projectId, sessionId);
  const activeCount = await store.countAtoms({ projectId, lifecycleStates: ['active'] });
  const banner = sessionBanner({ projectId, url: uiUrl, activeCount });

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
  const knowledge = ambient.length ? `DD - Project-wide knowledge (advisory):
${microPack(ambient)}` : null;
  const advisory = alreadyPrimed ? null
    : `DD - Project context (advisory): ${JSON.stringify({ ...context, ...(sessionId ? { session_id: sessionId } : {}) })}`;
  return {
    // `additionalContext` is for the model; `systemMessage` is the line the
    // person sees. The URL only goes in front of them once something answered
    // on it, so the link they click is a link that opens.
    ...(uiLive && uiUrl ? { systemMessage: uiPointer(uiUrl) } : {}),
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [banner, residentNotice(resident), advisory, knowledge].filter(Boolean).join('\n\n'),
    },
  };
}
