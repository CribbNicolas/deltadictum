// llms-full.txt: every docs page's Markdown in one file, in the sidebar's order, for language models.
import { getCollection } from 'astro:content';
import { LLMS, SITE } from '../config.js';
import { buildNav } from '../lib/nav.js';
import { llmsFull } from '../lib/llms.js';

export async function GET() {
  const entries = await getCollection('docs');
  const pages = entries.map(p => ({ id: p.id, body: p.body ?? '', ...p.data }));
  const text = llmsFull({ name: SITE.name, summary: LLMS.summary, groups: buildNav(pages), pages, siteUrl: new URL(SITE.base, SITE.url).href });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
