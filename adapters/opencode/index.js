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
// Scope of this adapter: DD's advisory context, injected once per session via the system prompt.
//
// OpenCode runs plugins in Bun, which has no `node:sqlite`: importing DD's store there fails at load
// (found 2026-09-24 by loading the published package into OpenCode 1.16.2). The adapter therefore
// imports none of DD and runs the SessionStart hook every other host runs, in Node (L3: Node >= 22),
// taking its context. That hook reaches the machine's resident, or starts one and says DD is
// inactive (L2). No Node, a timeout or any failure injects nothing and never blocks the host (L5).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADVISORY_FRAME } from './frame.js';

const HOOK = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
// The SessionStart hook's own limit on the other hosts.
const HOOK_TIMEOUT_MS = 15000;

function sessionStartContext(directory, sessionId) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('node', [HOOK, 'session-start'], { cwd: directory, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    } catch { return resolve(null); }
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve(null); }, HOOK_TIMEOUT_MS);
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', () => { clearTimeout(timer); resolve(null); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(output).hookSpecificOutput?.additionalContext ?? null); } catch { resolve(null); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ cwd: directory, session_id: sessionId, source: 'startup' }));
  });
}

// The module's only export: OpenCode loads each export as a plugin function.
export default async function DeltaDictum({ directory }) {
  const injected = new Set();

  return {
    'experimental.chat.system.transform': async (input, output) => {
      const sessionId = input.sessionID;
      if (!sessionId || injected.has(sessionId)) return;
      injected.add(sessionId);
      try {
        const context = await sessionStartContext(directory, sessionId);
        if (context) output.system.push(`${ADVISORY_FRAME}\n\n${context}`);
      } catch {
        // L5: a hook failure never blocks the host.
      }
    },
  };
}
