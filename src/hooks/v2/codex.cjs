'use strict';

// Codex (spec section 5, "Other harnesses"): it reads through shell commands and
// edits through apply_patch. Its payloads become the shapes the rest of DD reads
// (events.cjs), so matching, the ledger, checks and capture stay shared; only the
// Stop answer differs (decision: block with the reason).
const READERS = new Set(['cat', 'head', 'tail', 'less', 'more', 'nl', 'bat', 'type', 'wc', 'sed', 'get-content', 'gc']);
const SEARCHERS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'findstr', 'ls', 'dir', 'find', 'fd', 'tree', 'select-string', 'get-childitem', 'gci']);
const SHELL = /^(?:.*[\\/])?(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?$/i;

// The script a shell tool runs: Codex may send the argv of `bash -lc "<script>"`.
function commandText(command) {
  if (!Array.isArray(command)) return String(command ?? '');
  const [shell, flag, script] = command.map(String);
  if (SHELL.test(shell) && /^-(?:l?c|Command)$/i.test(flag ?? '') && script !== undefined) return script;
  return command.map(String).join(' ');
}

// 'read' or 'search' when every step of the script only looks at files (a cd
// between them is fine), null when any step may change something: a redirect
// into a file, an in-place sed, any other program.
function shellKind(script) {
  const text = String(script ?? '');
  if (/(?:^|[^>&\d])>/.test(text) || /\btee\b/.test(text)) return null;
  let kind = null;
  for (const step of text.split(/&&|\|\||;|\n/)) {
    const words = step.split('|')[0].trim().split(/\s+/).filter(Boolean);
    let name = (words[0] ?? '').toLowerCase();
    if (!name || name === 'cd') continue;
    if (name === 'git' && words[1] === 'grep') name = 'grep';
    if (name === 'sed' && words.some(word => /^-[a-z]*i/i.test(word) || word === '--in-place')) return null;
    if (READERS.has(name)) kind ??= 'read';
    else if (SEARCHERS.has(name)) kind = 'search';
    else return null;
  }
  return kind;
}

// A Codex payload in the shape events.cjs and capture read.
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
