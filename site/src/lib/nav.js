// The sidebar and the prev/next order, from the front matter the pages already carry:
// top-level pages form "Start", a page with has_children opens a section named by its
// title, a page's parent names its section, and nav_order orders both.
import { routeFor } from './routes.js';

const byOrder = (a, b) => (a.nav_order ?? 999) - (b.nav_order ?? 999) || a.title.localeCompare(b.title);
const item = page => ({ id: page.id, title: page.title, href: routeFor(page.id) });

export function buildNav(pages) {
  const sections = pages.filter(p => p.has_children).sort(byOrder);
  const names = new Set(sections.map(s => s.title));
  for (const page of pages) {
    if (page.parent && !names.has(page.parent)) throw new Error(`${page.id}: parent "${page.parent}" is not a section`);
  }
  const groups = [{ title: 'Start', items: pages.filter(p => !p.parent && !p.has_children && p.id !== 'index').sort(byOrder).map(item) }];
  for (const section of sections) {
    const children = pages.filter(p => p.parent === section.title).sort(byOrder);
    groups.push({ title: section.title, items: [{ ...item(section), title: 'Overview' }, ...children.map(item)] });
  }
  return groups;
}

export function neighbours(groups, id) {
  const flat = groups.flatMap(g => g.items);
  const at = flat.findIndex(i => i.id === id);
  return at === -1 ? {} : { prev: flat[at - 1], next: flat[at + 1] };
}
