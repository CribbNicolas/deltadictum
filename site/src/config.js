// Site-wide settings, shared by astro.config.mjs, the layouts and the build scripts.
export const SITE = {
  name: 'DeltaDictum',
  url: 'https://cribbnicolas.github.io',
  base: '/deltadictum/',
  repo: 'https://github.com/CribbNicolas/deltadictum',
  npm: 'https://www.npmjs.com/package/deltadictum',
  homeTitle: 'DeltaDictum: project knowledge for coding agents',
  description: 'DeltaDictum gives coding agents the engineering knowledge the code does not show, at the action it applies to. A local plugin for Claude Code, shared through git.',
  // The summary the landing shows; the newest by date when it is missing.
  featuredTrial: 'bench-2026-10-opus',
};

export const href = path => SITE.base + String(path).replace(/^\//, '');
