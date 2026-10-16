// The URL path of a docs page under the site base, as the Jekyll site published it:
// a section's index.md is its folder, every other page its .html file. Case is kept.
export function routeFor(id) {
  if (id === 'index') return '';
  if (id.endsWith('/index')) return id.slice(0, -'index'.length);
  return `${id}.html`;
}

// @astrojs/sitemap lists pages without their .html and sections without their slash;
// the sitemap must name the same URL as each page's canonical link.
export function sitemapUrl(url, { base, sections }) {
  const parsed = new URL(url);
  const path = decodeURIComponent(parsed.pathname.slice(base.length)).replace(/\/$/, '');
  if (path === '' || /\.[a-z0-9]+$/i.test(path)) return url;
  parsed.pathname = base + (sections.has(path) ? `${path}/` : `${path}.html`);
  return parsed.href;
}
