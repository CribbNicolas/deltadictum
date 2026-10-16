import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSite } from '../scripts/check-links.mjs';

function site(t, files) {
  const dist = mkdtempSync(join(tmpdir(), 'dd-site-'));
  t.after(() => rmSync(dist, { recursive: true, force: true }));
  for (const [path, html] of Object.entries(files)) {
    mkdirSync(join(dist, path, '..'), { recursive: true });
    writeFileSync(join(dist, path), html);
  }
  return dist;
}

test('a clean site has no errors', async t => {
  const dist = site(t, {
    'index.html': '<a href="/deltadictum/guide/">x</a><a href="/deltadictum/a.html#two">y</a><a href="https://example.com">z</a><img src="/deltadictum/logo.svg">',
    'guide/index.html': '<a href="../a.html">up</a><a href="#top">self</a><h1 id="top">t</h1>',
    'a.html': '<h2 id="two">Two</h2>',
    'logo.svg': '<svg/>',
  });
  assert.deepEqual(await checkSite(dist, { base: '/deltadictum/', legacy: ['', 'guide/', 'a.html'] }), []);
});

test('a missing page, a missing anchor and a missing legacy URL are reported', async t => {
  const dist = site(t, {
    'index.html': '<a href="/deltadictum/gone.html">x</a><a href="/deltadictum/a.html#nope">y</a>',
    'a.html': '<h2 id="two">Two</h2>',
  });
  const errors = await checkSite(dist, { base: '/deltadictum/', legacy: ['DD.html'] });
  assert.equal(errors.length, 3);
  assert.match(errors.join('\n'), /index\.html: \/deltadictum\/gone\.html/);
  assert.match(errors.join('\n'), /index\.html: \/deltadictum\/a\.html#nope \(no id "nope"\)/);
  assert.match(errors.join('\n'), /legacy URL DD\.html/);
});
