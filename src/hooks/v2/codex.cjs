'use strict';

const { shellKind } = require('./events.cjs');

// Codex (spec section 5, "Other harnesses"): it reads through shell commands and
// edits through apply_patch. Its payloads become the shapes the rest of DD reads
// (events.cjs), so matching, the ledger, checks and capture stay shared; only the
// Stop answer differs (decision: block with the reason).
const SHELL = /^(?:.*[\\/])?(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?$/i;

// The script a shell tool runs: Codex may send the argv of `bash -lc "<script>"`.
function commandText(command) {
  if (!Array.isArray(command)) return String(command ?? '');
  const [shell, flag, script] = command.map(String);
  if (SHELL.test(shell) && /^-(?:l?c|Command)$/i.test(flag ?? '') && script !== undefined) return script;
  return command.map(String).join(' ');
}

// A Codex payload in the shape events.cjs and capture read. The shell script is
// unwrapped from its argv here; events.cjs classifies it as every harness's.
function codexPayload(payload) {
  const name = String(payload.tool_name ?? '');
  const input = payload.tool_input ?? {};
  if (name === 'apply_patch') {
    const patch = typeof input === 'string' ? input : input.command ?? input.patch ?? input.input ?? '';
    return { ...payload, tool_input: { patch: String(patch) } };
  }
  if (/^(?:Bash|shell|local_shell|exec_command)$/i.test(name)) {
    const script = commandText(input.command ?? input.cmd);
    const kind = shellKind(script);
    return { ...payload, tool_name: kind === 'read' ? 'ShellRead' : kind === 'search' ? 'ShellSearch' : 'Bash', tool_input: { ...input, command: script } };
  }
  return payload;
}

module.exports = { codexPayload, commandText, shellKind };
