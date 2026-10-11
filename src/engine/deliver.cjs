'use strict';

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// What reaches the agent (spec section 3): each memory complete, asking for
// nothing. One additionalContext field holds 10,000 characters in Claude Code;
// past that, whole memories are named rather than any being cut.
const LIMIT = 10000;
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
const tailFor = rest => (rest.length ? `... and ${rest.length} more: ${rest.map(x => x.title).join('; ')}` : '');

// How many leading items fit whole, leaving room to name the rest. A hook claims
// only those: a memory that was only named is delivered at its next event.
function fitCount({ label, items, limit = LIMIT }) {
  let length = header(label).length;
  for (let i = 0; i < items.length; i += 1) {
    const next = line(items[i]);
    const tail = tailFor(items.slice(i + 1));
    if (length + 1 + next.length + (tail ? 1 + tail.length : 0) > limit) return i;
    length += 1 + next.length;
  }
  return items.length;
}

// Items in full while they fit, then the rest and `named` by title only.
function renderDelivery({ label, items, named = [], limit = LIMIT }) {
  if (!items?.length && !named.length) return '';
  const out = [header(label)];
  let length = out[0].length;
  // The tail of each candidate line names everything after it, `named` included.
  const shown = Math.min(fitCount({ label, items: [...items, ...named], limit }), items.length);
  for (const item of items.slice(0, shown)) { const next = line(item); out.push(next); length += 1 + next.length; }
  const rest = [...items.slice(shown), ...named];
  if (rest.length) {
    const tail = tailFor(rest);
    out.push(tail.length + length + 1 <= limit ? tail : tail.slice(0, Math.max(0, limit - length - 2)));
  }
  return out.join('\n');
}

module.exports = { LIMIT, staleEvidence, fitCount, renderDelivery };
