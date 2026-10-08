'use strict';

// The entry point every DD hook command names. CommonJS end to end: an ES module
// costs a hook about 3 ms. Any failure ends silently with exit 0: DD never
// blocks the host.
const { appendFileSync, readFileSync } = require('node:fs');
const { MINIMUM_NODE, supportedNode } = require('./node-support.cjs');

const command = process.argv[2] || 'session-start';
if (!supportedNode()) {
  // No DD module can load on this Node. Say why once, at session start, and
  // otherwise stay out of the way.
  if (command === 'session-start') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart',
      additionalContext: `DD - Inactive: DD needs Node.js ${MINIMUM_NODE} or later, and the node on this machine's PATH is ${process.version}. Tell the user this once.` } }));
  }
  process.exit(0);
}
// Codex runs these hooks too; its payloads are mapped in plan 7. Until then DD stays silent there.
if (process.argv.includes('--codex')) process.exit(0);

let payload;
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
// Opt-in record of what the harness sends, for checking payload shapes against a real session.
if (process.env.DD_CAPTURE_PAYLOADS) {
  try { appendFileSync(process.env.DD_CAPTURE_PAYLOADS, `${JSON.stringify({ command, payload })}\n`); } catch { /* debugging only */ }
}
require('../src/hooks/v2/hook.cjs').handle(command, payload)
  .then(output => { if (output) process.stdout.write(output); process.exit(0); }, () => process.exit(0));
