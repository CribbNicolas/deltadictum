import { retrieveMemories } from '../engine/retrieve.js';
import { microPack } from './session-start.js';
import { projectContext } from '../engine/project-context.js';

// The retrieval request a tool call becomes. Shared with the benchmark so a
// simulated tool call is shaped exactly like a real one.
export function preToolRequest(payload) {
  const tool = String(payload.toolName || payload.tool_name || '');
  if (!tool || /(^|__)(dd|deltadictum)(__|_)/i.test(tool)) return null;

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
  return { action, files, operation };
}

export async function buildPreToolContext(payload, { store, projectId, retrieve = retrieveMemories }) {
  const request = preToolRequest(payload);
  if (!request) return { decision: 'allow' };
  const context = await projectContext(store);
  const result = await retrieve({
    project_id: projectId,
    ...request, facts: context.facts,
    session_id: payload.session_id ?? payload.sessionId,
  }, { store });
  const pack = microPack(result.memories ?? []);
  if (!pack) return { decision: 'allow' };
  return {
    decision: 'allow',
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `DD - Project knowledge (advisory):\n${pack}`,
    },
  };
}
