import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmsIndex, llmsFull, plainMarkdown } from '../src/lib/llms.js';

const SITE = 'https://example.org/dd/';

// A page for models reads as plain Markdown: no front matter, no harness markers, every link absolute.
test('a page loses its front matter and harness markers, and its links become addresses', () => {
  const body = '---\r\ntitle: X\r\n---\r\n# X\r\n\r\n<!-- for: codex grok -->\r\nRun it.\r\n<!-- /for -->\r\n\r\n```bash for=opencode\r\nnpx x\r\n```\r\n\r\nSee [the UI](../using-dd.md#the-review-ui) and ![loop](../assets/a.svg).\r\n';
  const text = plainMarkdown(body, 'guide/how-it-works', SITE);
  assert.ok(text.startsWith('# X'));
  assert.match(text, /\*\*For Codex, Grok Build:\*\*\nRun it\./);
  assert.match(text, /For OpenCode:\n\n```bash\nnpx x/);
  assert.match(text, /\[the UI\]\(https:\/\/example\.org\/dd\/using-dd\.html#the-review-ui\)/);
  assert.match(text, /and \(loop\)\./);
  assert.doesNotMatch(text, /<!--|for=/);
});

test('llms.txt lists every page in the sidebar order, and llms-full.txt holds each one under its address', () => {
  const pages = [{ id: 'getting-started', title: 'Getting started', description: 'Install.', body: '# Getting started\n' },
    { id: 'guide/index', title: 'Reference', body: '# Reference\n' }, { id: 'guide/memories', title: 'Memories', body: '# Memories\n' }];
  const groups = [{ title: 'Start', items: [{ id: 'getting-started', title: 'Getting started', href: 'getting-started.html' }] },
    { title: 'Reference', items: [{ id: 'guide/index', title: 'Overview', href: 'guide/' }, { id: 'guide/memories', title: 'Memories', href: 'guide/memories.html' }] }];
  const index = llmsIndex({ name: 'DD', summary: 'Sum.', facts: ['Fact.'], groups, pages, siteUrl: SITE, full: `${SITE}llms-full.txt` });
  assert.match(index, /^# DD\n\n> Sum\.\n\n- Fact\.\n\n## Docs\n\n- \[Getting started\]\(https:\/\/example\.org\/dd\/getting-started\.html\): Install\./);
  assert.match(index, /- \[Reference\]\(https:\/\/example\.org\/dd\/guide\/\)\n- \[Memories\]/);
  assert.match(index, /llms-full\.txt/);
  const full = llmsFull({ name: 'DD', summary: 'Sum.', groups, pages, siteUrl: SITE });
  assert.deepEqual([...full.matchAll(/^Source: (.+)$/gm)].map(m => m[1]), [`${SITE}getting-started.html`, `${SITE}guide/`, `${SITE}guide/memories.html`]);
});
