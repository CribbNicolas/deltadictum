// Markdown in docs/ links to other pages by their .md file, so the links work on GitHub.
// On the site those become page URLs; links to anything else in the repository, including Markdown
// in the docs/ folders the site does not publish (offSite), go to GitHub.
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { walk } from './mdast.js';
import { routeFor } from './routes.js';

const GITHUB = 'https://github.com/CribbNicolas/deltadictum';

function inside(root, target) {
  const path = relative(root, target);
  return path === '' || path.startsWith('..') || isAbsolute(path) ? null : path.split(sep).join('/');
}

export function rewriteHref(href, { file, docsRoot, repoRoot, base, offSite = [] }) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('/')) return href;
  const cut = href.indexOf('#');
  const path = cut === -1 ? href : href.slice(0, cut);
  const anchor = cut === -1 ? '' : href.slice(cut);
  const target = resolve(dirname(file), decodeURI(path));
  const page = inside(docsRoot, target);
  if (page && page.endsWith('.md') && !offSite.includes(page.split('/')[0])) return base + routeFor(page.replace(/\.md$/, '')) + anchor;
  const repoPath = inside(repoRoot, target);
  if (!repoPath) return href;
  return `${GITHUB}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${repoPath}${anchor}`;
}

export function remarkDocLinks(options) {
  return () => (tree, file) => {
    walk(tree, node => {
      if (node.type === 'link' || node.type === 'definition') node.url = rewriteHref(node.url, { ...options, file: file.path });
    });
  };
}
