'use strict';

// A harness's tool call as the normalized event of spec section 3:
// { kind, paths, text }. Claude Code tool names here; other harnesses map their
// own payloads to the same events (plan 7).
const TOOL_EVENTS = ['Read', 'Edit', 'MultiEdit', 'NotebookEdit', 'Write', 'Bash', 'Grep', 'Glob'];

// A path under the project root, made repository-relative. Windows spells the
// root in any letter case and with either slash.
function relativize(path, root) {
  const slashed = String(path ?? '').replaceAll('\\', '/');
  const base = String(root ?? '').replaceAll('\\', '/').replace(/\/$/, '');
  if (base && slashed.replace(/\/$/, '').toLowerCase() === base.toLowerCase()) return '.';
  if (base && slashed.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return slashed.slice(base.length + 1);
  return slashed.replace(/^\.\//, '');
}

// Repository paths a shell command names: tokens with a folder separator or a file extension.
function bashPaths(command, root) {
  const tokens = String(command ?? '').split(/[\s;&|<>()]+/).map(token => token.replace(/^['"]+|['",]+$/g, ''));
  return [...new Set(tokens.filter(token => token && !token.startsWith('-') && !token.includes('://') && !token.includes('=')
    && (/^[\w@.~\-*:\\/]+[\\/][\w@.\-*\\/]*$/.test(token) || /^[\w@.-]+\.[a-z][a-z0-9]{0,4}$/i.test(token)))
    .map(token => relativize(token, root)))];
}

function toolEvent(name, input, root) {
  const path = p => relativize(p, root);
  const text = value => String(value ?? '');
  switch (name) {
    case 'Read': return { kind: 'read', paths: [path(input.file_path)] };
    case 'Edit': return { kind: 'edit', paths: [path(input.file_path)], text: text(input.new_string) };
    case 'MultiEdit': return { kind: 'edit', paths: [path(input.file_path)], text: (input.edits ?? []).map(e => text(e.new_string)).join('\n') };
    case 'NotebookEdit': return { kind: 'edit', paths: [path(input.notebook_path)], text: text(input.new_source) };
    case 'Write': return { kind: 'write', paths: [path(input.file_path)], text: text(input.content) };
    case 'Bash': return { kind: 'run', paths: bashPaths(input.command, root), text: text(input.command) };
    case 'Grep': return { kind: 'search', paths: input.path ? [path(input.path)] : [], text: text(input.pattern) };
    case 'Glob': return { kind: 'search', paths: input.path ? [path(input.path)] : [], text: text(input.pattern) };
    default: return null;
  }
}

module.exports = { TOOL_EVENTS, relativize, bashPaths, toolEvent };
