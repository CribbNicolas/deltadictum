// tollgate, the invented Go project of the bench (docs/superpowers/plans/2026-10-16-bench-02-tollgate.md):
// a webhook relay to an invented payments partner, built from tollgate/src with its history.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.mjs';
import { MEMORIES } from './tollgate/memories.js';
import { TASKS } from './tollgate/tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));

export default {
  id: 'tollgate',
  language: 'Go',
  repo: join(REPO, 'output', 'eval', 'bench', 'projects', 'tollgate'),
  base: 'main',
  invented: true,
  guideTarget: 'CLAUDE.md',
  store: 'bench',
  memories: MEMORIES,
  suite: { command: 'go', args: ['test', './...', '-count=1'], timeoutMs: 600000 },
  lint: { command: 'go', args: ['vet', './...'], timeoutMs: 300000 },
  programs: ['go', 'gofmt'],
  strip: [],
  links: [],
  probeFile: 'internal/relay/relay.go',
  // Failed tests by name, and packages that did not build or set up by theirs: those name no test.
  parseFailures: out => [...new Set([...out.matchAll(/^\s*--- FAIL: (\S+)|^FAIL\s+(\S+ \[(?:build|setup) failed\])/gm)].map(m => m[1] ?? m[2]))],
  setup: async () => { await buildFixture('tollgate'); },
  tasks: TASKS,
};
