// OpenCode (spec section 5, "Other harnesses"). Shapes confirmed against
// @opencode-ai/plugin's Hooks interface (dist/index.d.ts, read 2026-09-19):
// `tool.execute.before` gets (input: {tool, sessionID, callID}, output: {args}) and
// `tool.execute.after` gets the same input and the result, {title, output, metadata},
// whose `output` is the text the model reads.
//
// OpenCode has no hook that adds context before a tool runs, and text pushed into
// the system prompt changes the prompt on every delivery, which invalidates the
// prompt cache. DD's delivery therefore travels with the tool's own result: the
// memories that fire at a tool call are appended to that call's output, once per
// session, and the system prompt is never touched.
//
// OpenCode runs plugins in Bun, which has no `node:sqlite`: importing DD's store
// there fails at load (found 2026-09-24 with OpenCode 1.16.2). The adapter imports
// none of DD; it runs the hooks every other host runs, in Node, with Claude Code's
// payload shape. No Node, a timeout or any failure adds nothing and never blocks
// the host.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADVISORY_FRAME } from './frame.js';

const HOOK = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
// Hooks run outside the project folder: Windows cannot remove a folder a process is in.
const HOOK_CWD = fileURLToPath(new URL('.', import.meta.url));
// PreToolUse's limit on the other hosts; session start may compile the index.
const TIMEOUTS = { 'pre-tool': 10000, 'session-start': 30000 };

// OpenCode's tools as the Claude Code tool calls DD maps to events.
const TOOLS = {
  read: args => ['Read', { file_path: args.filePath }],
  edit: args => ['Edit', { file_path: args.filePath, new_string: args.newString }],
  multiedit: args => ['MultiEdit', { file_path: args.filePath, edits: (args.edits ?? []).map(edit => ({ new_string: edit.newString })) }],
  write: args => ['Write', { file_path: args.filePath, content: args.content }],
  bash: args => ['Bash', { command: args.command }],
  grep: args => ['Grep', { pattern: args.pattern, path: args.path }],
  glob: args => ['Glob', { pattern: args.pattern, path: args.path }],
  list: args => ['Glob', { pattern: '*', path: args.path }],
  patch: args => ['apply_patch', { patch: args.patchText }],
  apply_patch: args => ['apply_patch', { patch: args.patchText ?? args.patch ?? args.input }],
};

function runHook(command, payload, { wait = true } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('node', [HOOK, command], { cwd: HOOK_CWD, stdio: ['pipe', wait ? 'pipe' : 'ignore', 'ignore'], windowsHide: true });
    } catch { return resolve(null); }
    child.on('error', () => resolve(null));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
    if (!wait) { child.unref(); return resolve(null); }
    let output = '';
    const timer = setTimeout(() => { child.kill(); resolve(null); }, TIMEOUTS[command] ?? 10000);
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(output).hookSpecificOutput?.additionalContext ?? null); } catch { resolve(null); }
    });
  });
}

// The module's only export: OpenCode loads each export as a plugin function.
export default async function DeltaDictum({ directory }) {
  const started = new Set();
  const calls = new Map();
  const payloadOf = (input, args) => {
    const map = TOOLS[String(input?.tool ?? '').toLowerCase()];
    if (!map || !input.sessionID || !args) return null;
    const [tool_name, tool_input] = map(args);
    return { session_id: input.sessionID, cwd: directory, tool_name, tool_input };
  };

  return {
    // Session start injects nothing in v2; it compiles a stale index and starts
    // maintenance, once per session.
    'experimental.chat.system.transform': async input => {
      const sessionId = input?.sessionID;
      if (!sessionId || started.has(sessionId)) return;
      started.add(sessionId);
      try { await runHook('session-start', { cwd: directory, session_id: sessionId, source: 'startup' }); } catch { /* never blocks */ }
    },
    'tool.execute.before': async (input, output) => {
      if (input?.callID) calls.set(input.callID, output?.args);
    },
    'tool.execute.after': async (input, output) => {
      try {
        const args = calls.get(input?.callID);
        calls.delete(input?.callID);
        const payload = payloadOf(input, args);
        if (!payload) return;
        runHook('observe', payload, { wait: false });
        const context = await runHook('pre-tool', payload);
        if (context && typeof output?.output === 'string') output.output = `${output.output}\n\n${ADVISORY_FRAME}\n\n${context}`;
      } catch {
        // A hook failure never blocks the host.
      }
    },
  };
}
