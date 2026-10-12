'use strict';

const { readFileSync } = require('node:fs');
const { isAbsolute, join } = require('node:path');
const { PATH_FLAGS } = require('../engine/clause.cjs');
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
  try { text = readFileSync(isAbsolute(file) ? file : join(payload.cwd || root, file), 'utf8'); } catch { return null; }
  const edits = name === 'Edit' ? [input] : (Array.isArray(input.edits) ? input.edits : []);
  for (const edit of edits) {
    const from = String(edit.old_string ?? '');
    // An edit whose text is not in the file fails in the host; it is not judged as if it applied.
    if (!from || !text.includes(from)) return null;
    const to = String(edit.new_string ?? '');
    text = edit.replace_all ? text.split(from).join(to) : text.replace(from, () => to);
  }
  return text;
}

function toolViolations({ root, index, event, payload, ledger, bodies }) {
  const kind = event.kind;
  const checks = (index.checks ?? []).filter(check => check.on.includes(kind) && check.when === (kind === 'run' ? 'run' : 'edit'));
  if (!checks.length) return [];
  const matcher = createMatcher();
  const lines = [];
  for (const check of checks) {
    let target;
    let result;
    if (kind === 'run') {
      target = 'run';
      result = evaluateCommand(check, event.text, matcher);
    } else {
      target = event.paths[0];
      if (!target || !(check.paths ?? []).some(source => new RegExp(source, PATH_FLAGS).test(target))) continue;
      const content = contentAfter(root, payload);
      if (content === null) continue;
      result = evaluateContent(check, content, matcher);
    }
    if (!result.violated) continue;
    if (ledger && ledger.reported(check.m, target) >= REPORT_LIMIT) continue;
    if (ledger) ledger.report(check.m, target);
    const body = !ledger || !ledger.delivered().has(check.m) ? bodies?.[check.m]?.body : null;
    if (body && ledger) ledger.claim([check.m]);
    const title = index.memories[check.m]?.title ?? check.m;
    lines.push(`DD - check (${title}): ${check.say}${kind === 'run' ? '' : ` (${target})`}${body ? `\n${body}` : ''}`);
  }
  return lines;
}

module.exports = { contentAfter, toolViolations };
