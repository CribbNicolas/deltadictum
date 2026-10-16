// The URL path of a docs page under the site base, as the Jekyll site published it:
// a section's index.md is its folder, every other page its .html file. Case is kept.
export function routeFor(id) {
  if (id === 'index') return '';
  if (id.endsWith('/index')) return id.slice(0, -'index'.length);
  return `${id}.html`;
}
