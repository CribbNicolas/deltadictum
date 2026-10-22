// The docs for language models (llmstxt.org): llms.txt, a summary with a link to every page, and
// llms-full.txt, every page's Markdown in one file. Both are built from the docs themselves, so they
// say what the pages say. A harness panel loses its HTML comment markers and gains a label naming its
// harnesses; a relative link becomes the page's address on the site.
import { posix } from 'node:path';
import { HARNESSES } from './harness.js';
import { routeFor } from './routes.js';

const LABEL = Object.fromEntries(HARNESSES.map(h => [h.id, h.label]));
const names = list => list.split(/[\s,]+/).filter(Boolean).map(id => LABEL[id] ?? id).join(', ');

// One page's Markdown as plain Markdown: no front matter, no harness markers, absolute links.
export function plainMarkdown(body, id, siteUrl) {
  const dir = posix.dirname(id);
  const absolute = target => {
    const [path, hash = ''] = target.split('#');
    const resolved = posix.normalize(posix.join(dir === '.' ? '' : dir, path)).replace(/\.md$/, '');
    return new URL(routeFor(resolved) + (hash ? `#${hash}` : ''), siteUrl).href;
  };
  return body
    .replace(/\r\n/g, '\n')
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^<!--\s*for:\s*([\w\s-]+?)\s*-->$/gm, (_, ids) => `**For ${names(ids)}:**`)
    .replace(/^<!--\s*\/for\s*-->\n?/gm, '')
    .replace(/^```(\w*)\s+for=([\w,-]+)\s*$/gm, (_, lang, ids) => `For ${names(ids)}:\n\n\`\`\`${lang}`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '($1)')
    .replace(/\]\((?!https?:|#|mailto:)([^)\s]+\.md(?:#[^)\s]*)?)\)/g, (_, target) => `](${absolute(target)})`)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// llms.txt: the title, the summary, the facts a model most needs, then the pages in the sidebar's order.
export function llmsIndex({ name, summary, facts, groups, pages, siteUrl, full }) {
  const byId = new Map(pages.map(p => [p.id, p]));
  const lines = [`# ${name}`, '', `> ${summary}`, '', ...facts.map(fact => `- ${fact}`), ''];
  for (const group of groups) {
    lines.push(`## ${group.title === 'Start' ? 'Docs' : group.title}`, '');
    for (const item of group.items) {
      const page = byId.get(item.id);
      const title = item.title === 'Overview' ? page.title : item.title;
      lines.push(`- [${title}](${new URL(item.href, siteUrl).href})${page.description ? `: ${page.description}` : ''}`);
    }
    lines.push('');
  }
  lines.push('## Optional', '', `- [Every page in one file](${full}): the full documentation as Markdown`, '');
  return lines.join('\n');
}

// llms-full.txt: every page, in the sidebar's order, each under its address.
export function llmsFull({ name, summary, groups, pages, siteUrl }) {
  const byId = new Map(pages.map(p => [p.id, p]));
  const parts = [`# ${name}`, '', `> ${summary}`];
  for (const item of groups.flatMap(g => g.items)) {
    const page = byId.get(item.id);
    parts.push('', '---', '', `Source: ${new URL(item.href, siteUrl).href}`, '', plainMarkdown(page.body, page.id, siteUrl));
  }
  return `${parts.join('\n')}\n`;
}
