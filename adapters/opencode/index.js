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
// the same fallback shape used for a harness whose per-tool hook contract isn't confirmed.
import { buildSessionStartContext } from '../../src/hooks/session-start.js';
import { openStore } from '../../src/project.js';

export default async function DeltaDictum({ directory }) {
  let stateP;
  function state() {
    return stateP ??= openStore({ cwd: directory });
  }
  const injected = new Set();

  return {
    'experimental.chat.system.transform': async (input, output) => {
      const sessionId = input.sessionID;
      if (!sessionId || injected.has(sessionId)) return;
      injected.add(sessionId);
      const { store, projectId } = await state();
      const result = await buildSessionStartContext({ store, projectId, source: 'startup', sessionId });
      if (result.hookSpecificOutput?.additionalContext) {
        output.system.push(result.hookSpecificOutput.additionalContext);
      }
    },
  };
}
