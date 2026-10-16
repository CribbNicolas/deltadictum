// Project-Patriark, a real C#/.NET 8 game project with its own DD store, as a bench project
// (docs/superpowers/plans/2026-10-16-bench-05-patriark.md). The store is the repository's at the base
// commit (87 live memories of 357); the project commits a plugin setting and an AGENTS.md block that would
// bring DD into every condition, so prepare removes them in all four.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DOTNET_ENV } from './patriark/checks.js';
import { TASKS } from './patriark/tasks.js';

const REPO = process.env.PATRIARK_REPO ?? 'C:/dev/Project-Patriark';
const BASE = '5dedbca';

export const available = existsSync(join(REPO, '.git'));

// The memories as the repository holds them at the base commit.
function storeAt(base) {
  if (!available) return [];
  const git = (...args) => execFileSync('git', ['-c', `safe.directory=${REPO}`, '-C', REPO, ...args], { maxBuffer: 64 << 20 }).toString();
  return git('ls-tree', '--name-only', base, '.dd/memories/').split('\n').filter(name => name.endsWith('.json') && !name.endsWith('manifest.json'))
    .map(name => JSON.parse(git('show', `${base}:${name}`)));
}

async function prepare(dir) {
  const settings = join(dir, '.claude', 'settings.json');
  if (existsSync(settings)) {
    const json = JSON.parse(await readFile(settings, 'utf8'));
    if (json.enabledPlugins) delete json.enabledPlugins['dd@deltadictum'];
    await writeFile(settings, `${JSON.stringify(json, null, 2)}\n`);
  }
  const agents = join(dir, 'AGENTS.md');
  if (existsSync(agents)) {
    const text = await readFile(agents, 'utf8');
    await writeFile(agents, text.replace(/\n?<!-- BEGIN DD PROJECT KNOWLEDGE -->[\s\S]*?<!-- END DD PROJECT KNOWLEDGE -->\n?/, '\n'));
  }
  for (const name of ['dd', 'dd-audit', 'dd-clean', 'dd-compact', 'dd-init', 'dd-prospect', 'dd-recall', 'dd-review', 'dd-save']) {
    await rm(join(dir, '.agents', 'skills', name), { recursive: true, force: true });
  }
}

export default {
  id: 'patriark',
  language: 'C#',
  repo: REPO,
  base: BASE,
  invented: false,
  guideTarget: 'AGENTS.md',
  store: 'existing',
  memories: storeAt(BASE),
  suite: { command: 'dotnet', args: ['test', 'tests/Patriark.Tests.csproj', '--nologo'], timeoutMs: 900000, env: DOTNET_ENV },
  lint: null,
  programs: ['dotnet'],
  strip: [],
  links: [],
  probeFile: 'src/application/views/GameProjection.cs',
  // A timing assertion (under 250 ms) that a loaded machine misses: --conc runs builds side by side.
  knownFlaky: ['Patriark.Tests.DicePhysicsTests.FiveDiceSimulateFast'],
  parseFailures: out => [...new Set([...out.matchAll(/^\s*Failed (\S+) \[/gm)].map(m => m[1]))],
  prepare,
  // The generated setups and overlays, once before any worker starts (run.js calls setup per base).
  setup: async () => (await import('./patriark/generate.mjs')).ensureGenerated(),
  tasks: available ? TASKS : [],
};
