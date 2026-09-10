import { retrieveMemories } from '../engine/retrieve.js';
import { sessionBanner } from './banner.js';

export function microPack(memories) {
  return memories.map(memory => {
    const flag = memory.memory_type === 'anti_memory' ? 'ANTI' : memory.memory_type.toUpperCase();
    return `[${flag}] ${memory.content || memory.retrieval_forms?.micro || memory.title}`;
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

export async function buildSessionStartContext({ store, projectId, uiUrl }) {
  const activeCount = await store.countAtoms({ projectId, lifecycleStates: ['active'] });
  const banner = sessionBanner({ projectId, url: uiUrl, activeCount });

  const result = await retrieveMemories({
    project_id: projectId,
    action: 'session start coding in this repository',
    budget_tokens: 200,
  }, { store });
  const antiAndCanonical = (result.memories ?? []).filter(memory =>
    memory.memory_type === 'anti_memory' || memory.authority === 'canonical' || memory.form_type === 'micro',
  );
  const pack = microPack(antiAndCanonical.slice(0, 12));
  const advisory = pack ? `DD - ${pack}` : '';
  return {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: [banner, advisory].filter(Boolean).join('\n\n'),
    },
  };
}
