import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import { fileURLToPath } from 'node:url';
import { SITE } from './src/config.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  site: SITE.url,
  base: SITE.base,
  // about.astro -> about.html, about/index.astro -> about/index.html: the URLs Jekyll published.
  build: { format: 'preserve' },
  integrations: [sitemap()],
  markdown: {
    processor: unified({ remarkPlugins: [] }),
    shikiConfig: { theme: 'github-dark-default' },
  },
  vite: { server: { fs: { allow: [repoRoot] } } },
});
