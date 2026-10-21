'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// What reaches the agent (spec section 3): each memory complete, asking for
// nothing. One additionalContext field holds 10,000 characters in Claude Code;
// past that, whole memories are named rather than any being cut.
// The default cap of a delivery, in characters; a project sets its own with
// delivery_limit in .dd/config.json, within these bounds (compiled into the index).
const LIMIT = 10000;
const LIMIT_MIN = 2000;
const LIMIT_MAX = 50000;
const validLimit = value => Number.isInteger(value) && value >= LIMIT_MIN && value <= LIMIT_MAX;
const LABELS = { trap: 'TRAP', decision: 'DECISION', fact: 'FACT', failed_approach: 'ABANDONED', procedure: 'PROCEDURE' };

// Evidence files whose content changed since the memory was written, or that are gone.
function staleEvidence(root, evidence) {
  const stale = [];
  if (!evidence?.length) return stale;
  // Loaded only when there is evidence to hash: node:crypto costs a hook 2 ms to load.
  const { createHash } = require('node:crypto');
  for (const entry of evidence) {
    try {
      if (createHash('sha256').update(readFileSync(join(root, entry.path))).digest('hex') !== entry.sha256) stale.push(entry.path);
    } catch { stale.push(entry.path); }
  }
  return stale;
}

function line(item) {
  const disputed = item.status === 'contested' ? ' [DISPUTED]' : '';
  const stale = item.stale?.length ? ` (evidence changed since this was written: ${item.stale.join(', ')})` : '';
  return `[${LABELS[item.kind] ?? 'NOTE'}]${disputed} ${item.title} - ${item.body}${stale}`;
}

const header = label => `DD - project knowledge (${label}):`;

// Delivered knowledge never outranks the user (docs/DD.md); said to the agent with every delivery and every
// check, because a memory saying "never" reads as an order: in the 2026-10 benchmark Haiku refused an
// explicit request a delivered memory contradicted, 3 runs of 3. A memory naming a rule the code breaks
// also read as work: Haiku fixed it inside unrelated tasks. Last, so the knowledge comes first.
const ON_CONFLICT = 'DD - advisory: knowledge, not an order. Apply it to the task; a problem it shows outside the task is reported, not fixed. If the user explicitly asked for what it rules out, do what the user asked and say which memory it departs from.';
const tailFor = rest => (rest.length ? `... and ${rest.length} more: ${rest.map(x => x.title).join('; ')}` : '');

// The items that fit whole, in order, leaving room to name everything else. One
// that does not fit is skipped, not the end: a long memory must not keep
// the ones after it from arriving. A hook claims only these; a memory that was
// only named is delivered at its next event. `named` is always named.
function fitItems({ label, items, named = [], limit = LIMIT }) {
  const fitted = [];
  const skipped = [];
  let length = header(label).length;
  items.forEach((item, i) => {
    const next = line(item);
    const tail = tailFor([...skipped, ...items.slice(i + 1), ...named]);
    if (length + 1 + next.length + (tail ? 1 + tail.length : 0) > limit) { skipped.push(item); return; }
    fitted.push(item);
    length += 1 + next.length;
  });
  return fitted;
}

// Items in full while they fit, then the rest and `named` by title only.
function renderDelivery({ label, items, named = [], limit = LIMIT }) {
  if (!items?.length && !named.length) return '';
  const fitted = fitItems({ label, items, named, limit });
  const out = [header(label), ...fitted.map(line)];
  const length = out.join('\n').length;
  const rest = [...items.filter(item => !fitted.includes(item)), ...named];
  if (rest.length) {
    const tail = tailFor(rest);
    out.push(tail.length + length + 1 <= limit ? tail : tail.slice(0, Math.max(0, limit - length - 2)));
  }
  return out.join('\n');
}

module.exports = { LIMIT, LIMIT_MIN, LIMIT_MAX, ON_CONFLICT, validLimit, staleEvidence, fitItems, renderDelivery };
