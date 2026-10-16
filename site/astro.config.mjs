import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { fileURLToPath } from 'node:url';
import { SITE } from './src/config.js';
import { remarkDocLinks } from './src/lib/links.js';
import { remarkCallouts } from './src/lib/callouts.js';
import { sitemapUrl } from './src/lib/routes.js';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = fileURLToPath(new URL('../docs', import.meta.url));
// Folders of docs/ with an index.md: their URL is the folder, with its slash.
const sections = new Set(readdirSync(docsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(join(docsRoot, entry.name, 'index.md'))).map(entry => entry.name));

export default defineConfig({
  site: SITE.url,
  base: SITE.base,
  // about.astro -> about.html, about/index.astro -> about/index.html: the URLs Jekyll published.
  build: { format: 'preserve' },
  integrations: [sitemap({ serialize: item => ({ ...item, url: sitemapUrl(item.url, { base: SITE.base, sections }) }) })],
  markdown: {
    processor: unified({ remarkPlugins: [remarkDocLinks({ docsRoot, repoRoot, base: SITE.base }), remarkCallouts] }),
    shikiConfig: { theme: 'github-dark-default' },
  },
  vite: { server: { fs: { allow: [repoRoot] } } },
});
