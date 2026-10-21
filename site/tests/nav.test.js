import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildNav, neighbours } from '../src/lib/nav.js';
import { describe } from '../src/lib/describe.js';

const PAGES = [
  { id: 'using-dd', title: 'Using DD well', nav_order: 3 },
  { id: 'getting-started', title: 'Getting started', nav_order: 2 },
  { id: 'guide/index', title: 'Reference', nav_order: 4, has_children: true },
  { id: 'guide/memories', title: 'Memories', parent: 'Reference', nav_order: 2 },
  { id: 'guide/how-it-works', title: 'How DD works', parent: 'Reference', nav_order: 1 },
  { id: 'architecture/index', title: 'Architecture', nav_order: 7, has_children: true },
  { id: 'DD', title: 'Behavioural contract', parent: 'Architecture', nav_order: 1 },
];

test('top-level pages form Start; sections follow in order, each opening with its overview', () => {
  const groups = buildNav(PAGES);
  assert.deepEqual(groups.map(g => g.title), ['Start', 'Reference', 'Architecture']);
  assert.deepEqual(groups[0].items.map(i => i.href), ['getting-started.html', 'using-dd.html']);
  assert.deepEqual(groups[1].items.map(i => i.title), ['Overview', 'How DD works', 'Memories']);
  assert.equal(groups[1].items[0].href, 'guide/');
  assert.equal(groups[2].items[1].href, 'DD.html');
});

test('a section of one page lists the page under its own title, without an overview', () => {
  const groups = buildNav([...PAGES, { id: 'commands', title: 'Commands', nav_order: 4, has_children: true }]);
  assert.deepEqual(groups.map(g => g.title), ['Start', 'Commands', 'Reference', 'Architecture']);
  assert.deepEqual(groups[1].items.map(i => [i.title, i.href]), [['Commands', 'commands.html']]);
});

test('prev and next follow the sidebar order across sections', () => {
  const groups = buildNav(PAGES);
  assert.equal(neighbours(groups, 'using-dd').prev.id, 'getting-started');
  assert.equal(neighbours(groups, 'using-dd').next.id, 'guide/index');
  assert.equal(neighbours(groups, 'getting-started').prev, undefined);
  assert.equal(neighbours(groups, 'DD').next, undefined);
});

test('a page whose parent is no section fails, naming the page', () => {
  assert.throws(() => buildNav([...PAGES, { id: 'x', title: 'X', parent: 'Nowhere' }]), /x: parent "Nowhere" is not a section/);
});

test('a description comes from the first paragraph, without Markdown, cut at a word', () => {
  const body = '# Title\n\n```text\ncode\n```\n\nA coding agent reads [your code](x.md) **well**. It cannot read the decision.\n\nNext.';
  assert.equal(describe(body), 'A coding agent reads your code well. It cannot read the decision.');
  assert.equal(describe('Word '.repeat(60), 30), 'Word Word Word Word Word Word…');
  assert.equal(describe('# Only a heading\r\n\r\n| a | b |'), '');
});
