#!/usr/bin/env node
import { sanitizeText } from '../engine/v2/sanitizer.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { openStore, readJsonStdin } from '../project.js';
import { readUiUrl } from './banner.js';
import { buildSessionStartContext, contextPayload } from './session-start.js';
import { STOP_CAPTURE_PROMPT } from './capture.js';
import { buildPreToolContext } from './pre-tool.js';

function ok(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}

function skip() {
  process.exit(0);
}

function microPack(memories) {
  return memories.map(memory => {
    const flag = memory.memory_type === 'anti_memory' ? 'ANTI' : memory.memory_type.toUpperCase();
    return `[${flag}] ${memory.content || memory.retrieval_forms?.micro || memory.title}`;
  }).join('\n');
}

const command = process.argv[2];

try {
  const payload = await readJsonStdin();
  const { store, projectId, ddDir } = await openStore();

  if (command === 'session-start') {
    const result = await buildSessionStartContext({
      store,
      projectId,
      uiUrl: await readUiUrl(ddDir),
    });
    store.close();
    ok(result);
  }

  if (command === 'pre-tool') {
    const result = await buildPreToolContext(payload, { store, projectId });
    store.close();
    ok(result);
  }

  if (command === 'prompt') {
    const action = payload.prompt || payload.text || payload.user_prompt || '';
    const result = await retrieveMemories({
      project_id: projectId,
      action,
      budget_tokens: payload.budget_tokens,
    }, { store });
    store.close();
    ok(contextPayload('UserPromptSubmit', microPack(result.memories ?? [])));
  }

  if (command === 'observe') {
    const preview = sanitizeText(
      payload.tool_input && JSON.stringify(payload.tool_input) ||
      payload.tool_response ||
      payload.content ||
      payload.text ||
      'empty',
    ).slice(0, 4000) || 'empty';
    await store.putObservation({
      project_id: projectId,
      source_type: 'tool_output',
      source_ref: payload.tool_name || payload.tool || 'tool',
      raw_preview: preview,
      metadata: { tool: payload.tool_name || payload.tool || null },
    });
    store.close();
    skip();
  }

  if (command === 'stop') {
    store.close();
    ok(contextPayload(
      'Stop',
      STOP_CAPTURE_PROMPT,
    ));
  }

  store.close();
  skip();
} catch {
  process.exit(0);
}
