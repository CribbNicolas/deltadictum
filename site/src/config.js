// Site-wide settings, shared by astro.config.mjs, the layouts and the build scripts.
export const SITE = {
  name: 'DeltaDictum',
  url: 'https://cribbnicolas.github.io',
  base: '/deltadictum/',
  repo: 'https://github.com/CribbNicolas/deltadictum',
  npm: 'https://www.npmjs.com/package/deltadictum',
  homeTitle: 'DeltaDictum: project knowledge for coding agents',
  description: 'DeltaDictum gives coding agents the engineering knowledge the code does not show, at the action it applies to. A local plugin for Claude Code, shared through git.',
  // The landing's table: the average of these trials (Opus and Haiku), with the two guide conditions as one.
  featured: {
    title: 'Benchmark with blind judge',
    trials: ['bench-2026-10-fix-opus', 'bench-2026-10-fix-haiku'],
    merge: { doc: { label: 'With documentation', of: ['docref', 'doc'] } },
    note: 'Every figure is an average.',
  },
};

// The landing's results. totalRuns counts every agent run recorded under output/eval since the first
// benchmark (each run once by benchmark, model and run id; backups left out): the raw data stays out of
// git, so the count is written here and updated after a benchmark. The featured metric leads, the others
// follow two to a row; each card's headline says what its number means.
export const LANDING = {
  totalRuns: 1883,
  highlight: 'dd2',
  featured: 'requirements',
  rows: [['quality', 'resolution'], ['cost', 'context']],
  headlines: {
    requirements: 'Does it the way your project does',
    quality: 'Better code, scored by a blind judge',
    resolution: 'Finishes what it starts',
    cost: 'Practically the same cost as the agent alone',
    context: 'Barely more for the agent to read',
  },
};

// The opening of llms.txt and llms-full.txt (src/lib/llms.js): what a model should know before it reads
// any page. Every fact here is stated in the docs too; keep them in step.
export const LLMS = {
  summary: 'DeltaDictum (DD) is a local plugin for coding-agent harnesses that keeps the engineering knowledge a project\'s code does not show (decisions, traps, abandoned approaches, procedures, facts) as JSON memories in git, and delivers each one to the agent right before the tool call it applies to.',
  facts: [
    'Harnesses: Claude Code is supported and measured; Codex, OpenCode and Grok Build have adapters not yet verified in a live session.',
    'Requirements: Node.js 22.16 or later and a git repository. No account, no model calls, no background process, no runtime dependency, no network request.',
    'A project opts in with a `.dd/` folder: `npx deltadictum init` writes `.dd/config.json`, `.dd/.gitignore` and `.dd/memories/`. A project without it is left alone.',
    'A memory is `.dd/memories/<id>.json`: kind, topic, title, body, `not_derivable` (why the code does not show it), triggers, an optional check, evidence.',
    'Delivery is rule matching over a compiled index (paths, symbols, commands, keywords), not similarity search; each memory arrives at most once per session, framed as advice that never outranks the user.',
    'The agent saves by writing a proposal to `.dd/inbox/`; DD validates it and activates it only when it verified the evidence itself (auto-accept, on by default), otherwise it waits for a person in the review UI (`npx deltadictum ui`).',
    '`npx deltadictum doctor` says whether DD is working in a project; a failing hook never blocks the agent.',
  ],
};

// Folders of docs/ the site does not publish (development notes and benchmark data, kept out of git).
export const OFF_SITE = ['superpowers', 'research', 'benchmarks', 'architecture'];

export const href = path => SITE.base + String(path).replace(/^\//, '');
