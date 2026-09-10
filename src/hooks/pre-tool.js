import { retrieveMemories } from '../engine/retrieve.js';
import { microPack } from './session-start.js';

export async function buildPreToolContext(payload, { store, projectId }) {
  const tool = String(payload.toolName || payload.tool_name || '');
  if (!tool || /(^|__)(dd|deltadictum)(__|_)/i.test(tool)) return { decision: 'allow' };

  const input = payload.toolInput ?? payload.tool_input ?? {};
  const serialized = typeof input === 'string' ? input : JSON.stringify(input);
  const action = `${tool} ${serialized}`.slice(0, 800);
  const result = await retrieveMemories({
    project_id: projectId,
    action,
  }, { store });
  const pack = microPack(result.memories ?? []);
  if (!pack) return { decision: 'allow' };
  return {
    decision: 'allow',
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `DD - ${pack}`,
    },
  };
}
