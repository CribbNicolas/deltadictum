'use strict';

const { pathToFileURL } = require('node:url');
const { join } = require('node:path');
const { MINIMUM_NODE, supportedNode } = require('./node-support.cjs');

const command = process.argv[2] || 'session-start';
if (!supportedNode()) {
  // No DD module can load on this Node. Say why once, at session start, and
  // otherwise stay out of the way (L2, L5).
  if (command === 'session-start') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart',
      additionalContext: `DD - Inactive: DD needs Node.js ${MINIMUM_NODE} or later, and the node on this machine's PATH is ${process.version}. Tell the user this once.` } }));
  }
  process.exit(0);
}
const target = join(__dirname, '..', 'src', 'hooks', 'run.js');
process.argv = [process.execPath, target, command];
import(pathToFileURL(target).href).catch(() => process.exit(0));
