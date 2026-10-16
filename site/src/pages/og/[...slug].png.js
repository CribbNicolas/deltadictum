// One 1200x630 Open Graph image per page, from its title and section, in the site's colours.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCollection } from 'astro:content';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { SITE } from '../../config.js';

const font = weight => readFileSync(resolve(`node_modules/@fontsource/geist-sans/files/geist-sans-latin-${weight}-normal.woff`));
const FONTS = [{ name: 'Geist', data: font(400), weight: 400 }, { name: 'Geist', data: font(700), weight: 700 }];
// satori lays out flex boxes only: every element gets display flex.
const h = (type, style, children) => ({ type, props: { style: { display: 'flex', ...style }, children } });

export async function getStaticPaths() {
  const pages = await getCollection('docs');
  return [
    { params: { slug: 'index' }, props: { title: 'What your code doesn\'t say, said at the right moment.', section: 'Plugin for coding agents' } },
    ...pages.map(page => ({ params: { slug: page.id }, props: { title: page.data.title, section: page.data.parent ?? 'Docs' } })),
  ];
}

export async function GET({ props }) {
  const mark = h('div', { width: 64, height: 64, borderRadius: 32, border: '10px solid #e8b84a', display: 'flex', justifyContent: 'center' },
    [h('div', { width: 10, height: 44, background: '#e8b84a' }, [])]);
  const svg = await satori(
    h('div', { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 72, background: '#0b0d10', fontFamily: 'Geist' }, [
      h('div', { display: 'flex', alignItems: 'center', gap: 20, color: '#f0f3f6', fontSize: 34, fontWeight: 700 }, [mark, SITE.name]),
      h('div', { display: 'flex', flexDirection: 'column', gap: 18 }, [
        h('div', { color: '#e8b84a', fontSize: 28 }, props.section.toUpperCase()),
        h('div', { color: '#f5f7fa', fontSize: 68, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }, props.title),
      ]),
      h('div', { color: '#9aa4b2', fontSize: 26 }, 'cribbnicolas.github.io/deltadictum'),
    ]),
    { width: 1200, height: 630, fonts: FONTS },
  );
  const png = new Resvg(svg).render().asPng();
  return new Response(png, { headers: { 'Content-Type': 'image/png' } });
}
