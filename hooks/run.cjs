'use strict';

// The entry point every DD hook command names. CommonJS end to end: an ES module
// costs a hook about 3 ms. Any failure ends silently with exit 0: DD never
// blocks the host.
// A module that fails to load (a partial install, a checkout on another branch)
// throws before any handler could catch it: end silently then too.
process.on('uncaughtException', () => process.exit(0));
const { readFileSync } = require('node:fs');
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
// Codex runs these hooks with --codex and Grok Build with --grok: their payloads are mapped in
// src/hooks/codex.cjs and src/hooks/grok.cjs.
const host = process.argv.includes('--codex') ? 'codex' : process.argv.includes('--grok') ? 'grok' : 'claude';

let payload;
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { process.exit(0); }
require('../src/hooks/hook.cjs').handle(command, payload, { host })
  .then(output => { if (output) process.stdout.write(output); process.exit(0); }, () => process.exit(0));
