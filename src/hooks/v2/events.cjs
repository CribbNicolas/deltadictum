'use strict';

// A harness's tool call as the normalized event of spec section 3:
// { kind, paths, text }. Claude Code tool names here, plus the names Codex
// payloads are mapped to (codex.cjs).
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

// A relative path from the session's folder, made absolute. Claude Code may start
// in a subfolder, and Bash keeps its folder after a cd. Slashes only, so a
// Windows root reads the same on any platform.
const ABSOLUTE = /^(?:[A-Za-z]:)?[\\/]|^[A-Za-z]:$/;
function fromFolder(folder, path) {
  const text = String(path ?? '').replaceAll('\\', '/');
  if (!folder || !text || ABSOLUTE.test(text)) return text;
  const parts = String(folder).replaceAll('\\', '/').replace(/\/$/, '').split('/');
  for (const part of text.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') { if (parts.length > 1) parts.pop(); } else parts.push(part);
  }
  return parts.join('/');
}

// Repository paths a shell command names: tokens with a folder separator or a file extension.
function bashPaths(command, root, cwd = root) {
  const tokens = String(command ?? '').split(/[\s;&|<>()]+/).map(token => token.replace(/^['"]+|['",]+$/g, ''));
  return [...new Set(tokens.filter(token => token && !token.startsWith('-') && !token.includes('://') && !token.includes('=')
    && (/^[\w@.~\-*:\\/]+[\\/][\w@.\-*\\/]*$/.test(token) || /^[\w@.-]+\.[a-z][a-z0-9]{0,4}$/i.test(token)))
    .map(token => relativize(fromFolder(cwd, token), root)))];
}

// The files an apply_patch names in its headers, and the lines it adds. A patch
// that only adds files writes; one that changes or deletes any edits.
function patchEvent(patch, path) {
  const headers = [...String(patch ?? '').matchAll(/^\*\*\* (Add File|Update File|Delete File|Move to): (.+)$/gm)];
  const added = String(patch ?? '').split('\n').filter(line => line.startsWith('+')).map(line => line.slice(1)).join('\n');
  const kind = headers.length && headers.every(([, action]) => action === 'Add File') ? 'write' : 'edit';
  return { kind, paths: [...new Set(headers.map(([, , file]) => path(file.trim())))], text: added };
}

function toolEvent(name, input, root, cwd = root) {
  const path = p => relativize(fromFolder(cwd, p), root);
  const text = value => String(value ?? '');
  switch (name) {
    case 'Read': return { kind: 'read', paths: [path(input.file_path)] };
    case 'Edit': return { kind: 'edit', paths: [path(input.file_path)], text: text(input.new_string) };
    case 'MultiEdit': return { kind: 'edit', paths: [path(input.file_path)], text: (input.edits ?? []).map(e => text(e.new_string)).join('\n') };
    case 'NotebookEdit': return { kind: 'edit', paths: [path(input.notebook_path)], text: text(input.new_source) };
    case 'Write': return { kind: 'write', paths: [path(input.file_path)], text: text(input.content) };
    case 'Bash': return { kind: 'run', paths: bashPaths(input.command, root, cwd), text: text(input.command) };
    case 'Grep': return { kind: 'search', paths: input.path ? [path(input.path)] : [], text: text(input.pattern) };
    case 'Glob': return { kind: 'search', paths: input.path ? [path(input.path)] : [], text: text(input.pattern) };
    // Codex (codex.cjs names them): shell commands that only read or search, and patches.
    case 'ShellRead': return { kind: 'read', paths: bashPaths(input.command, root, cwd), text: text(input.command) };
    case 'ShellSearch': return { kind: 'search', paths: bashPaths(input.command, root, cwd), text: text(input.command) };
    case 'apply_patch': return patchEvent(input.patch, path);
    default: return null;
  }
}

module.exports = { TOOL_EVENTS, relativize, bashPaths, toolEvent };
