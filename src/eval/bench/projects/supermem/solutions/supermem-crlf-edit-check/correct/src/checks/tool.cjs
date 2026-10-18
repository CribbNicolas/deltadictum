'use strict';

const { readFileSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');
const { REPORT_LIMIT } = require('../engine/ledger.cjs');
const { evaluateCommand, evaluateContent } = require('./check.cjs');
const { createMatcher } = require('./pattern.cjs');

// Checks that speak at the tool call (spec section 6): command checks, before the
// command runs, and `when: edit` checks on the file as the edit would leave it.
// Turn checks wait for Stop.
function contentAfter(root, payload) {
  const input = payload.tool_input ?? {};
  const name = payload.tool_name;
  if (name === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (name !== 'Edit' && name !== 'MultiEdit') return null;
  const file = String(input.file_path ?? '');
  let text;
  // Git for Windows checks files out with CRLF and the Edit tool matches with plain
  // newlines: the text is judged with plain newlines too.
  try { text = readFileSync(isAbsolute(file) ? file : join(payload.cwd || root, file), 'utf8').replace(/\r\n/g, '\n'); } catch { return null; }
  const edits = name === 'Edit' ? [input] : (Array.isArray(input.edits) ? input.edits : []);
  for (const edit of edits) {
    const from = String(edit.old_string ?? '').replace(/\r\n/g, '\n');
    // An edit whose text is not in the file fails in the host; it is not judged as if it applied.
    if (!from || !text.includes(from)) return null;
    const to = String(edit.new_string ?? '').replace(/\r\n/g, '\n');
    text = edit.replace_all ? text.split(from).join(to) : text.replace(from, () => to);
  }
  return text;
}

// `checks` are the ones that apply to this call (hook.cjs applicableChecks); the
// memories' bodies are read only once a violation is found.
function toolViolations({ root, event, index, payload, ledger, checks, bodiesOf = () => null }) {
  const kind = event.kind;
  if (!checks.length) return [];
  let matcher;
  const match = () => (matcher ??= createMatcher());
  const lines = [];
  for (const check of checks) {
    let target;
    let result;
    if (kind === 'run') {
      target = 'run';
      result = evaluateCommand(check, event.text, match());
    } else {
      target = event.paths[0];
      const content = contentAfter(root, payload);
      if (content === null) continue;
      result = evaluateContent(check, content, match());
    }
    if (!result.violated) continue;
    if (ledger && ledger.reported(check.m, target) >= REPORT_LIMIT) continue;
    if (ledger) ledger.report(check.m, target);
    const body = !ledger || !ledger.delivered().has(check.m) ? bodiesOf()?.[check.m]?.body : null;
    if (body && ledger) ledger.claim([check.m]);
    const title = index.memories[check.m]?.title ?? check.m;
    lines.push(`DD - check (${title}): ${check.say}${kind === 'run' ? '' : ` (${target})`}${body ? `\n${body}` : ''}`);
  }
  return lines;
}

module.exports = { contentAfter, toolViolations };
