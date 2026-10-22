'use strict';

// The entry point every DD hook command names. CommonJS end to end: an ES module
// costs a hook about 3 ms. Any failure ends silently with exit 0: DD never
// blocks the host.
// A module that fails to load (a partial install, a checkout on another branch)
// throws before any handler could catch it: end silently then too.
// Codex runs these hooks with --codex, Grok Build with --grok and Cursor with --cursor: their payloads are
// mapped in src/hooks/codex.cjs, grok.cjs and cursor.cjs.
const host = process.argv.includes('--codex') ? 'codex' : process.argv.includes('--grok') ? 'grok'
  : process.argv.includes('--cursor') ? 'cursor' : 'claude';
// Cursor records a hook that prints nothing as failed: it gets an empty answer instead.
const quit = () => { if (host === 'cursor') process.stdout.write('{}'); process.exit(0); };
process.on('uncaughtException', quit);
const { readFileSync } = require('node:fs');
const { MINIMUM_NODE, supportedNode } = require('./node-support.cjs');

const command = process.argv[2] || 'session-start';
if (!supportedNode()) {
  // No DD module can load on this Node. Say why once, at session start, and
  // otherwise stay out of the way.
  if (command === 'session-start' && host !== 'cursor') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart',
      additionalContext: `DD - Inactive: DD needs Node.js ${MINIMUM_NODE} or later, and the node on this machine's PATH is ${process.version}. Tell the user this once.` } }));
  }
  quit();
}

let payload;
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { quit(); }
require('../src/hooks/hook.cjs').handle(command, payload, { host })
  .then(output => { if (!output) quit(); process.stdout.write(output); process.exit(0); }, quit);
