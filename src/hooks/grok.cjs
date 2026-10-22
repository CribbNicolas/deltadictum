'use strict';

// Grok Build runs the hooks a Claude Code plugin registers, with a payload of its own (its hook guide,
// ~/.grok/docs/user-guide/10-hooks.md, read 2026-10-22 with grok 1.0.41): camelCase keys (sessionId,
// toolName, toolInput, toolResult, stopHookActive) and its own tool names. Only a matcher maps Claude
// Code's names to Grok's; the payload keeps Grok's. Its payloads become the shapes the rest of DD reads
// (events.cjs), as Codex's do. Field names not in the guide were read from the binary's serde names
// (SearchReplaceInput: file_path or filePath, old_string, new_string, edits, replace_all); they are not
// yet confirmed against a recorded session.
const TOOLS = { read_file: 'Read', search_replace: 'Edit', run_terminal_command: 'Bash', grep: 'Grep', list_dir: 'Glob' };

const fileOf = input => input.file_path ?? input.filePath ?? input.path ?? input.target_file ?? input.absolute_path;

function toolInputOf(tool, input) {
  if (tool === 'Read') return { file_path: fileOf(input) };
  if (tool === 'Edit') {
    const edits = Array.isArray(input.edits) ? input.edits : [];
    const oldText = input.old_string ?? input.oldString ?? edits.map(edit => edit.old_string ?? edit.oldString ?? '').join('\n');
    const newText = input.new_string ?? input.newString ?? edits.map(edit => edit.new_string ?? edit.newString ?? '').join('\n');
    // An empty old string writes a new file: Grok has no separate write tool.
    return oldText === '' ? { file_path: fileOf(input), content: newText } : { file_path: fileOf(input), old_string: oldText, new_string: newText };
  }
  if (tool === 'Grep') return { pattern: input.pattern ?? input.query, path: fileOf(input) };
  if (tool === 'Glob') return { pattern: '*', path: fileOf(input) };
  return input;
}

// A Grok payload in the shape events.cjs and capture read. One already in Claude Code's shape (a test,
// or a later Grok that sends both) passes through.
function grokPayload(payload) {
  if (!('toolName' in payload) && !('sessionId' in payload)) return payload;
  const name = String(payload.toolName ?? payload.tool_name ?? '');
  const input = payload.toolInput ?? payload.tool_input ?? {};
  const tool = TOOLS[name] ?? name;
  const result = payload.toolResult ?? payload.tool_response;
  const out = { ...payload, session_id: payload.sessionId ?? payload.session_id ?? process.env.GROK_SESSION_ID, cwd: payload.cwd ?? payload.workspaceRoot };
  if (name) {
    out.tool_name = tool === 'Edit' && toolInputOf(tool, input).content !== undefined ? 'Write' : tool;
    out.tool_input = typeof input === 'object' && input ? toolInputOf(tool, input) : input;
  }
  // A shell result carries exit_code and output_for_prompt (the guide's updatedToolOutput example).
  if (result && typeof result === 'object') out.tool_response = { ...result, output: result.output ?? result.output_for_prompt };
  // Grok also fires Stop when the session ends (reason channel_closed or shutdown): no turn is left to
  // ask anything of, so it reads as a Stop already answered.
  if (payload.stopHookActive !== undefined) out.stop_hook_active = payload.stopHookActive;
  if (typeof payload.reason === 'string' && payload.reason !== 'end_turn' && /stop/i.test(String(payload.hook_event_name ?? ''))) out.stop_hook_active = true;
  if (payload.subagentType) out.agent_id = payload.subagentType;
  return out;
}

module.exports = { grokPayload, TOOLS };
