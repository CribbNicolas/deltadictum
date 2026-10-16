// Fails the build on an internal link or image that resolves to no file, on a #fragment
// the target page has no id for, and on a URL the Jekyll site served that the build lost.
// External links are not fetched.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await htmlFiles(path));
    else if (entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

// A site path (under the base, no leading slash) to the file that serves it, as GitHub Pages does.
function fileFor(dist, path) {
  const clean = decodeURIComponent(path);
  const candidates = clean === '' || clean.endsWith('/') ? [`${clean}index.html`] : [clean, `${clean}.html`, `${clean}/index.html`];
  return candidates.map(c => join(dist, c)).find(existsSync) ?? null;
}

export async function checkSite(dist, { base, legacy }) {
  const errors = [];
  const ids = new Map();
  const idsOf = async file => {
    if (!ids.has(file)) ids.set(file, new Set([...(await readFile(file, 'utf8')).matchAll(/\sid="([^"]+)"/g)].map(m => m[1])));
    return ids.get(file);
  };
  for (const file of await htmlFiles(dist)) {
    const html = await readFile(file, 'utf8');
    const from = relative(dist, file).split(sep).join('/');
    for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) continue;
      const [path, fragment] = url.split('#');
      let target;
      if (path === '') target = file;
      else {
        const sitePath = path.startsWith('/') ? (path.startsWith(base) ? path.slice(base.length) : null) : posix.join(posix.dirname(from), path);
        if (sitePath === null) { errors.push(`${from}: ${url} is outside ${base}`); continue; }
        target = fileFor(dist, sitePath.replace(/^\.\//, ''));
        if (!target) { errors.push(`${from}: ${url}`); continue; }
      }
      if (fragment && target.endsWith('.html') && !(await idsOf(target)).has(decodeURIComponent(fragment))) errors.push(`${from}: ${url} (no id "${fragment}")`);
    }
  }
  for (const url of legacy) if (!fileFor(dist, url)) errors.push(`legacy URL ${url || '(home)'} no longer resolves`);
  return errors;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const { SITE } = await import('../src/config.js');
  const legacy = (await readFile(join(root, 'tests/fixtures/legacy-urls.txt'), 'utf8')).replace(/\r\n/g, '\n').split('\n').slice(0, -1);
  const errors = await checkSite(join(root, 'dist'), { base: SITE.base, legacy });
  for (const error of errors) console.error(`broken: ${error}`);
  if (errors.length) process.exit(1);
  console.log('links: all internal links and legacy URLs resolve');
}
