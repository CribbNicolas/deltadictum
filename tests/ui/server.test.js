import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { startReviewServer } from '../../src/ui/server.js';
import { memory, project } from '../helpers/review.js';

// Raw requests: fetch() rewrites Host and cannot send a foreign one.
function call(server, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: server.port, path, method, headers: { host: `127.0.0.1:${server.port}`, ...headers } }, res => {
      let text = '';
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function serve(t, memories = [memory('m1'), memory('c1', { status: 'candidate', topic: 'ui/c1' })]) {
  const root = await project(t, memories);
  const server = await startReviewServer({ root, port: 0 });
  t.after(() => server.close());
  const entry = await call(server, `/?key=${server.key}`);
  const cookie = String(entry.headers['set-cookie'] ?? '').split(';')[0];
  return { root, server, cookie, entry };
}

test('the key becomes a strict cookie, and nothing answers without it or to another host', async t => {
  const { server, cookie, entry } = await serve(t);
  assert.equal(entry.status, 303);
  assert.match(cookie, /^dd_review_\d+=[0-9a-f]+$/);
  assert.match(String(entry.headers['set-cookie']), /SameSite=Strict/);
  assert.equal((await call(server, '/api/overview')).status, 403);
  assert.equal((await call(server, '/api/overview', { headers: { cookie, host: 'evil.example' } })).status, 403);
  const page = await call(server, '/', { headers: { cookie } });
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /script-src 'nonce-[0-9a-f]+'/);
});

test('reads and actions go through the API; mutations take JSON only', async t => {
  const { server, cookie } = await serve(t);
  const json = (path, init = {}) => call(server, path, { ...init, headers: { cookie, 'content-type': 'application/json', ...init.headers } });
  const overview = JSON.parse((await json('/api/overview')).text);
  assert.equal(overview.queues.candidates, 1);
  const detail = JSON.parse((await json('/api/memories/m1')).text);
  assert.equal(detail.memory.id, 'm1');
  assert.equal((await json('/api/memories/c1/accept', { method: 'POST', body: '{}' })).status, 200);
  const refused = await json('/api/memories/m1', { method: 'PUT', body: JSON.stringify({ not_derivable: '' }) });
  assert.equal(refused.status, 400);
  assert.ok(JSON.parse(refused.text).problems.includes('not_derivable_required'));
  // A cross-site form post cannot send JSON.
  const form = await call(server, '/api/memories/m1/archive', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=x' });
  assert.equal(form.status, 415);
  assert.equal((await json('/api/memories/nope')).status, 404);
  assert.equal((await json('/api/memories?queue=bogus')).status, 400);
});

test('a malformed percent-encoding in an API path is refused, not an internal error', async t => {
  const { server, cookie } = await serve(t);
  const bad = await call(server, '/api/memories/%E0%A4%A', { headers: { cookie } });
  assert.equal(bad.status, 400);
});
