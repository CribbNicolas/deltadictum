// ledgerkit, the invented Python project of the bench (docs/superpowers/plans/2026-10-16-bench-03-ledgerkit.md):
// a bookkeeping CLI for an invented accounting firm, built from ledgerkit/src with its history.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.mjs';
import { MEMORIES } from './ledgerkit/memories.js';
import { TASKS } from './ledgerkit/tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export default {
  id: 'ledgerkit',
  language: 'Python',
  repo: join(REPO, 'output', 'eval', 'bench', 'projects', 'ledgerkit'),
  base: 'main',
  invented: true,
  guideTarget: 'CLAUDE.md',
  store: 'bench',
  memories: MEMORIES,
  suite: { command: 'python', args: ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], timeoutMs: 600000 },
  lint: { command: 'python', args: ['-m', 'compileall', '-q', 'ledgerkit', 'tests', 'tools'], timeoutMs: 120000 },
  programs: ['python'],
  strip: [],
  links: [],
  probeFile: 'ledgerkit/report.py',
  parseFailures: out => [...new Set([...out.matchAll(/^(?:FAIL|ERROR): (\S+)/gm)].map(m => m[1]))],
  setup: async () => { await buildFixture('ledgerkit'); },
  tasks: TASKS,
};
