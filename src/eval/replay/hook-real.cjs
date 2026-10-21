'use strict';

// The production delivery path a pre-tool hook runs, timed by the bench:
//   node hook-real.cjs <project root> <session id>  < event.json
// It times deliverFor (src/hooks/hook.cjs) on an already normalized event.
const { readFileSync } = require('node:fs');
const { deliverFor } = require('../../hooks/hook.cjs');

try {
  const [root, session] = process.argv.slice(2);
  const event = JSON.parse(readFileSync(0, 'utf8') || '{}');
  const text = deliverFor(root, event, session ? { id: session } : null);
  if (text) process.stdout.write(JSON.stringify({ additionalContext: text }));
} catch { /* fail open */ }
process.exit(0);
