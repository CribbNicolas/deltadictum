// supermem, DeltaDictum itself, as a real bench project (docs/superpowers/plans/2026-10-16-bench-04-supermem.md):
// tasks mined from v2 fix commits and the 2026-10-14 trial's tasks, on a bench store of their lessons.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MEMORIES } from './supermem/memories.js';
import { MINED_TASKS } from './supermem/mined.js';
import { PORTED_TASKS } from './supermem/ported.js';

const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

// node --test lists each failure under "✖ failing tests:" as "✖ <name> (<ms>)".
const parseFailures = out => [...new Set([...(out.split('✖ failing tests:')[1] ?? '').matchAll(/^✖ (.+?) \([\d.]+m?s\)$/gm)].map(m => m[1]))];

export default {
  id: 'supermem',
  language: 'JavaScript',
  repo: REPO,
  base: '5af14ac',
  invented: false,
  guideTarget: 'CLAUDE.md',
  store: 'bench',
  memories: MEMORIES,
  suite: { command: 'npm', args: ['test'], shell: true, timeoutMs: 900000 },
  lint: { command: 'npm', args: ['run', 'lint'], shell: true, timeoutMs: 300000 },
  programs: [],
  strip: [],
  links: [],
  probeFile: 'src/cli.js',
  parseFailures,
  // The second failed twice in a full run whose change touched only the UI, then passed 5/5 on that change:
  // forgiven only when the change leaves maintenance and the hooks alone.
  knownFlaky: ['a write waits for another process holding the telemetry lock instead of failing',
    { test: 'session start starts maintenance in the background when it is due, and says nothing', unlessChanged: ['src/maintenance/', 'src/hooks/'] }],
  tasks: [...MINED_TASKS, ...PORTED_TASKS],
};
