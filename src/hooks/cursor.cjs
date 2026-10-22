'use strict';

const { existsSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');

// Cursor (spec section 5, "Other harnesses"), in preview. Shapes read from the Cursor CLI's own source
// (agent-cli-package 2026.10.19-6bbf2c4) and its hooks page, not yet from a recorded session: every event
// carries conversation_id and workspace_roots; preToolUse and postToolUse carry tool_name and tool_input;
// postToolUse adds tool_output, a JSON string ({"exitCode":0,"stdout":...} for Shell); postToolUseFailure
// adds error_message and failure_type; stop carries status and loop_count. Its tools: Read {file_path},
// Write {file_path, content} (the whole file: Cursor's edits are writes too), Shell {command,
// working_directory}, Grep {pattern, file_path, glob}, List and Delete {file_path}. Its payloads become the
// shapes the rest of DD reads (events.cjs), as Codex's and Grok's do.
const FAILURES = new Set(['error', 'timeout']);

function parsed(text) {
  if (typeof text !== 'string') return text && typeof text === 'object' ? text : undefined;
  try { const value = JSON.parse(text); return value && typeof value === 'object' ? value : { output: text }; } catch { return { output: text }; }
}

// A Write to a file that exists is an edit. Only before the call can that be told: after it the file exists.
function writeOf(input, cwd, before) {
  const file = input.file_path ?? input.path;
  const full = file && cwd && !isAbsolute(String(file)) ? join(cwd, String(file)) : file;
  const edit = before && full && existsSync(String(full));
  return edit ? ['Edit', { file_path: file, new_string: input.content ?? '' }] : ['Write', { file_path: file, content: input.content ?? '' }];
}

function toolOf(name, input, cwd, before) {
  switch (name) {
    case 'Read': return ['Read', { file_path: input.file_path ?? input.path }];
    case 'Write': return writeOf(input, cwd, before);
    case 'Delete': return ['Edit', { file_path: input.file_path ?? input.path, new_string: '' }];
    case 'Shell': return ['Bash', { command: input.command ?? '' }];
    case 'Grep': return ['Grep', { pattern: input.pattern, path: input.file_path ?? input.path }];
    case 'List': return ['Glob', { pattern: '*', path: input.file_path ?? input.path }];
    default: return [name, input];
  }
}

// A Cursor payload in the shape events.cjs and capture read. `command` is the DD hook that runs: the payload's
// fields, not its event name, tell a result from a failure.
function cursorPayload(payload, command) {
  const roots = Array.isArray(payload.workspace_roots) ? payload.workspace_roots : [];
  const input = payload.tool_input && typeof payload.tool_input === 'object' ? payload.tool_input : {};
  const cwd = payload.cwd || input.working_directory || roots[0] || process.env.CURSOR_PROJECT_DIR || '';
  const out = { ...payload, session_id: payload.conversation_id ?? payload.session_id, cwd };
  if (payload.tool_name) {
    const [tool, mapped] = toolOf(String(payload.tool_name), input, cwd, command === 'pre-tool');
    out.tool_name = tool;
    out.tool_input = mapped;
  }
  if (payload.tool_output !== undefined) out.tool_response = parsed(payload.tool_output) ?? {};
  // A denied call (by a hook or the person) and an interrupt are not the tool failing.
  if (payload.failure_type !== undefined || payload.error_message !== undefined) {
    out.tool_response = { error: String(payload.error_message ?? '') };
    if (FAILURES.has(payload.failure_type) && !payload.is_interrupt) out.is_error = true;
  }
  // Cursor stops asking after loop_limit follow-ups; a turn already continued once, or one that did not
  // complete, is not asked again.
  if (command === 'stop') out.stop_hook_active = Number(payload.loop_count) > 0 || (payload.status !== undefined && payload.status !== 'completed');
  return out;
}

module.exports = { cursorPayload };
