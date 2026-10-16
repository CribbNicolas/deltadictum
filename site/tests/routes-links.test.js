import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { routeFor, sitemapUrl } from '../src/lib/routes.js';
import { rewriteHref } from '../src/lib/links.js';
import { remarkCallouts } from '../src/lib/callouts.js';

const repoRoot = resolve('/repo');
const docsRoot = resolve('/repo/docs');
const at = (file, href) => rewriteHref(href, { file: resolve(docsRoot, file), docsRoot, repoRoot, base: '/deltadictum/' });

test('a page id maps to the URL Jekyll published', () => {
  assert.equal(routeFor('getting-started'), 'getting-started.html');
  assert.equal(routeFor('DD'), 'DD.html');
  assert.equal(routeFor('guide/index'), 'guide/');
  assert.equal(routeFor('guide/how-it-works'), 'guide/how-it-works.html');
  assert.equal(routeFor('index'), '');
});

test('links between pages become site URLs and keep their anchors', () => {
  assert.equal(at('getting-started.md', 'using-dd.md#troubleshooting'), '/deltadictum/using-dd.html#troubleshooting');
  assert.equal(at('guide/how-it-works.md', '../DD.md'), '/deltadictum/DD.html');
  assert.equal(at('index.md', 'guide/index.md'), '/deltadictum/guide/');
  assert.equal(at('benchmarks/index.md', '../guide/how-it-works.md#how-it-is-measured'), '/deltadictum/guide/how-it-works.html#how-it-is-measured');
});

test('links to files that are not pages go to GitHub', () => {
  assert.equal(at('benchmarks/index.md', 'data/'), 'https://github.com/CribbNicolas/deltadictum/tree/main/docs/benchmarks/data');
  assert.equal(at('guide/storage.md', '../../src/memory/store.js'), 'https://github.com/CribbNicolas/deltadictum/blob/main/src/memory/store.js');
  assert.equal(at('DD.md', '../CHANGELOG.md#090'), 'https://github.com/CribbNicolas/deltadictum/blob/main/CHANGELOG.md#090');
});

test('absolute, external and in-page links are left alone', () => {
  for (const href of ['https://nodejs.org', 'mailto:a@b.c', '#checks', '/deltadictum/']) assert.equal(at('using-dd.md', href), href);
});

test('a blockquote that opens with bold text ending in a colon or a period is a callout', () => {
  const quote = text => ({ type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'strong', children: [{ type: 'text', value: text }] }, { type: 'text', value: ' more' }] }] });
  const tree = { type: 'root', children: [quote('Tip:'), quote('One test.'), quote('Plain'), { type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] }] };
  remarkCallouts()(tree);
  assert.deepEqual(tree.children.map(n => n.data?.hProperties?.className ?? null), [['callout'], ['callout'], null, null]);
});

test('sitemap URLs match the canonical URL of each page', () => {
  const sections = new Set(['guide', 'architecture']);
  const at = path => sitemapUrl(`https://cribbnicolas.github.io/deltadictum/${path}`, { base: '/deltadictum/', sections });
  assert.equal(at(''), 'https://cribbnicolas.github.io/deltadictum/');
  assert.equal(at('getting-started'), 'https://cribbnicolas.github.io/deltadictum/getting-started.html');
  assert.equal(at('DD'), 'https://cribbnicolas.github.io/deltadictum/DD.html');
  assert.equal(at('guide'), 'https://cribbnicolas.github.io/deltadictum/guide/');
  assert.equal(at('guide/'), 'https://cribbnicolas.github.io/deltadictum/guide/');
  assert.equal(at('guide/how-it-works'), 'https://cribbnicolas.github.io/deltadictum/guide/how-it-works.html');
  assert.equal(at('getting-started.html'), 'https://cribbnicolas.github.io/deltadictum/getting-started.html');
});
