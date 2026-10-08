'use strict';

const { createHash } = require('node:crypto');
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
  for (const entry of evidence ?? []) {
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

function renderDelivery({ label, items, limit = LIMIT }) {
  if (!items?.length) return '';
  const out = [`DD - project knowledge (${label}):`];
  let length = out[0].length;
  for (let i = 0; i < items.length; i += 1) {
    const next = line(items[i]);
    const rest = items.slice(i + 1);
    const tail = rest.length ? `... and ${rest.length} more: ${rest.map(x => x.title).join('; ')}` : '';
    if (length + 1 + next.length + (tail ? 1 + tail.length : 0) <= limit) { out.push(next); length += 1 + next.length; continue; }
    const named = `... and ${items.length - i} more: ${items.slice(i).map(x => x.title).join('; ')}`;
    out.push(named.length + length + 1 <= limit ? named : named.slice(0, Math.max(0, limit - length - 2)));
    break;
  }
  return out.join('\n');
}

module.exports = { LIMIT, staleEvidence, renderDelivery };
