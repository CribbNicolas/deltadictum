// Crawlers read robots.txt only at a host's root, which this project site does not own;
// this file names the sitemap for tools that look under the base. Submit the sitemap in Search Console.
import { SITE } from '../config.js';

export function GET() {
  return new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL(`${SITE.base}sitemap-index.xml`, SITE.url).href}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
