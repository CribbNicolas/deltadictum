// llms.txt (llmstxt.org): what DD is and a link to every docs page, for language models.
import { getCollection } from 'astro:content';
import { LLMS, SITE } from '../config.js';
import { buildNav } from '../lib/nav.js';
import { llmsIndex } from '../lib/llms.js';

export async function GET() {
  const pages = (await getCollection('docs')).map(p => ({ id: p.id, ...p.data }));
  const siteUrl = new URL(SITE.base, SITE.url).href;
  const text = llmsIndex({ name: SITE.name, ...LLMS, groups: buildNav(pages), pages, siteUrl, full: new URL('llms-full.txt', siteUrl).href });
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
