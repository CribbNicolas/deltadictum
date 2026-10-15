'use strict';

const { isAbsolute, join } = require('node:path');
const { LIMIT } = require('../engine/deliver.cjs');
const { REPORT_LIMIT } = require('../engine/ledger.cjs');
const { CONTENT_MAX, evaluateCommand, evaluateContent, readHead } = require('./check.cjs');
const { createMatcher } = require('./pattern.cjs');

// Checks that speak at the tool call (spec section 6): command checks, before the
// command runs, and `when: edit` checks on the file as the edit would leave it.
// Turn checks wait for Stop.
// The file as it is before the call, or null (a new file). Its first megabyte: a
// check judges the first 256 KB, and an edit beyond what was read is not judged.
// Git for Windows checks files out with CRLF and the Edit tool matches with plain
// newlines: the text is judged with plain newlines too.
function contentBefore(root, payload) {
  const file = String(payload.tool_input?.file_path ?? '');
  const head = readHead(isAbsolute(file) ? file : join(payload.cwd || root, file), CONTENT_MAX * 4);
  return head === null ? null : head.replace(/\r\n/g, '\n');
}

function contentAfter(root, payload, before) {
  const input = payload.tool_input ?? {};
  const name = payload.tool_name;
  if (name === 'Write') return typeof input.content === 'string' ? input.content : null;
  if (name !== 'Edit' && name !== 'MultiEdit') return null;
  let text = before;
  if (text === null) return null;
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
// memories' bodies are read only once a violation is found. The lines share one
// field with the delivery (`budget`, spec section 3): a line that does not fit
// waits for the next call, unreported; a body that does not fit comes at the
// memory's next event, unclaimed.
function toolViolations({ root, event, index, payload, ledger, checks, bodiesOf = () => null, budget = LIMIT }) {
  const kind = event.kind;
  if (!checks.length) return [];
  let matcher;
  const match = () => (matcher ??= createMatcher());
  const lines = [];
  let used = 0;
  for (const check of checks) {
    let target;
    let result;
    if (kind === 'run') {
      target = 'run';
      result = evaluateCommand(check, event.text, match());
    } else {
      target = event.paths[0];
      const before = contentBefore(root, payload);
      const content = contentAfter(root, payload, before);
      if (content === null) continue;
      result = evaluateContent(check, content, match());
      // Only a violation the call introduces is reported (owner, 2026-10-13).
      if (result.violated && before !== null && evaluateContent(check, before, match()).violated) continue;
    }
    if (!result.violated) continue;
    if (ledger && ledger.reported(check.m, target) >= REPORT_LIMIT) continue;
    const title = index.memories[check.m]?.title ?? check.m;
    const bare = `DD - check (${title}): ${check.say}${kind === 'run' ? '' : ` (${target})`}`;
    const separator = lines.length ? 1 : 0;
    if (used + separator + bare.length > budget) continue;
    if (ledger) ledger.report(check.m, target);
    let body = !ledger || !ledger.delivered().has(check.m) ? bodiesOf()?.[check.m]?.body : null;
    if (body && used + separator + bare.length + 1 + body.length > budget) body = null;
    if (body && ledger) ledger.claim([check.m], { kind, viaOf: () => ['check'] });
    const line = `${bare}${body ? `\n${body}` : ''}`;
    lines.push(line);
    used += separator + line.length;
  }
  return lines;
}

module.exports = { contentAfter, toolViolations };
