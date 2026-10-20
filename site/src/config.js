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

// Folders of docs/ the site does not publish (development notes and benchmark data, kept out of git).
export const OFF_SITE = ['superpowers', 'research', 'benchmarks', 'architecture'];

export const href = path => SITE.base + String(path).replace(/^\//, '');
