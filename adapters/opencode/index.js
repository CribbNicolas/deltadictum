// Confirmed against @opencode-ai/plugin@1.18.31's dist/index.d.ts (Hooks interface) and a real
// installed plugin (opencode-helicone-session@1.0.1's dist/index.js), read 2026-09-19.
//
// OpenCode's plugin hooks that fire per tool call (`tool.execute.before`/`.after`) carry no field
// that can inject text into the model's context -- `tool.execute.before`'s output is `{args}` only,
// and `event` (session lifecycle) returns Promise<void>, no output object at all. The one hook that
// accepts injectable text is `experimental.chat.system.transform`: (input: {sessionID?, model},
// output: {system: string[]}), which fires once per chat turn, not once per tool call. There is no
// OpenCode hook shaped like Claude Code's PreToolUse (fires per tool, can inject advisory context) --
// this is a real API gap, not something this adapter works around by guessing at an undocumented
// field. `tool.execute.after`'s output ({title, output, metadata}) also carries no structured
// exit/error signal, so wiring it to observationFromTool would misclassify results rather than skip
// them as unknown -- left unwired for the same reason src/hooks/observe.js already documents for any
// host with an unconfirmed response shape.
//
// Scope of this adapter: DD's advisory context, injected once per session via the system prompt --
// the same fallback shape used for a harness whose per-tool hook contract isn't confirmed. It follows
// the session-start path of src/hooks/run.js: the machine's resident answers, or DD is inactive, one
// is started, and the context says why (L2). A failure injects nothing and never blocks the host (L5).
import { callRunningStore } from '../../src/hooks/bridge.js';
import { buildSessionStartContext, lexicalMode } from '../../src/hooks/session-start.js';
import { findRepoRoot, openStore } from '../../src/project.js';
import { ensureResident, sessionUiUrl } from '../../src/resident.js';

async function sessionStartContext(directory, sessionId) {
  const repoRoot = await findRepoRoot(directory);
  const bridged = await callRunningStore('session-start', { session_id: sessionId, source: 'startup', cwd: directory }, repoRoot);
  if (bridged) return bridged.hookSpecificOutput?.additionalContext;
  const lexical = lexicalMode();
  const started = await ensureResident(repoRoot).catch(() => ({ state: 'unavailable' }));
  // A live resident that did not answer this call (timeout, stale build) is not serving it either.
  const resident = started.state === 'live' ? { state: 'unreachable' } : started;
  const { store, projectId } = await openStore({ cwd: directory });
  try {
    const result = await buildSessionStartContext({
      resident: lexical ? { state: 'live', retrieval: 'lexical' } : resident,
      store,
      projectId,
      uiUrl: await sessionUiUrl(repoRoot, started),
      sessionId,
      source: 'startup',
    });
    return result.hookSpecificOutput?.additionalContext;
  } finally {
    store.close();
  }
}

export default async function DeltaDictum({ directory }) {
  const injected = new Set();

  return {
    'experimental.chat.system.transform': async (input, output) => {
      const sessionId = input.sessionID;
      if (!sessionId || injected.has(sessionId)) return;
      injected.add(sessionId);
      try {
        const context = await sessionStartContext(directory, sessionId);
        if (context) output.system.push(context);
      } catch {
        // L5: a hook failure never blocks the host.
      }
    },
  };
}
