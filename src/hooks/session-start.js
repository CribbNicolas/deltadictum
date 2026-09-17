import { sessionBanner } from './banner.js';
import { orientProject } from '../engine/project-context.js';

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

export async function buildSessionStartContext({ store, projectId, uiUrl, sessionId, source }) {
  if (sessionId && ['compact', 'clear'].includes(source)) await store.clearSessionDeliveries(projectId, sessionId);
  const activeCount = await store.countAtoms({ projectId, lifecycleStates: ['active'] });
  const banner = sessionBanner({ projectId, url: uiUrl, activeCount });

  const context = await orientProject({ budget_tokens: 400 }, { store, projectId });
  const advisory = `DD - Project context (advisory): ${JSON.stringify({ ...context, ...(sessionId ? { session_id: sessionId } : {}) })}`;
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [banner, advisory].filter(Boolean).join('\n\n'),
    },
  };
}
