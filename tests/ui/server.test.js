import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
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
  assert.equal((await json('/api/memories/m1/reviewed', { method: 'POST', body: '{}' })).status, 200);
  assert.equal(JSON.parse((await json('/api/memories/m1')).text).memory.review.accepted.by, 'person');
  const refused = await json('/api/memories/m1', { method: 'PUT', body: JSON.stringify({ not_derivable: '' }) });
  assert.equal(refused.status, 400);
  assert.ok(JSON.parse(refused.text).problems.includes('not_derivable_required'));
  // A cross-site form post cannot send JSON.
  const form = await call(server, '/api/memories/m1/archive', { method: 'POST', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' }, body: 'reason=x' });
  assert.equal(form.status, 415);
  assert.equal((await json('/api/memories/nope')).status, 404);
  assert.equal((await json('/api/memories?queue=bogus')).status, 400);
});

test('an agent request is carried out through the API; one that needs a person is refused', async t => {
  const { server, cookie, root } = await serve(t, [memory('m1'), memory('a1', { topic: 'ui/a1', status: 'archived' })]);
  const dir = join(root, '.dd', 'local', 'requests');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'r1.json'), JSON.stringify({ id: 'r1', request: 'delete', target: 'a1', why: 'Archived long ago.' }));
  writeFileSync(join(dir, 'r2.json'), JSON.stringify({ id: 'r2', request: 'revise', target: 'm1', why: 'Outdated.' }));
  const post = path => call(server, path, { method: 'POST', body: '{}', headers: { cookie, 'content-type': 'application/json' } });
  const applied = await post('/api/requests/r1/apply');
  assert.equal(applied.status, 200);
  assert.deepEqual(JSON.parse(applied.text).done, ['a1']);
  const refused = await post('/api/requests/r2/apply');
  assert.equal(refused.status, 400);
  assert.ok(JSON.parse(refused.text).problems.includes('needs_a_person'));
});

test('a malformed percent-encoding in an API path is refused, not an internal error', async t => {
  const { server, cookie } = await serve(t);
  const bad = await call(server, '/api/memories/%E0%A4%A', { headers: { cookie } });
  assert.equal(bad.status, 400);
});

// The project's settings, read and changed from the UI: .dd/config.json keeps every key it has.
test('the settings are read and changed through the API; unknown keys are kept and bad values refused', async t => {
  const { server, cookie, root } = await serve(t);
  const json = (path, init = {}) => call(server, path, { ...init, headers: { cookie, 'content-type': 'application/json', ...init.headers } });
  writeFileSync(join(root, '.dd', 'config.json'), JSON.stringify({ project_id: 'p', custom: 1 }));
  const before = JSON.parse((await json('/api/config')).text);
  assert.deepEqual({ ...before, limits: undefined }, { project_id: 'p', auto_accept: true, delivery_limit: 10000, retire_after_sessions: 20, limits: undefined, file: { project_id: 'p', custom: 1 } });
  assert.equal((await json('/api/config', { method: 'PUT', body: JSON.stringify({ auto_accept: false }) })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.dd', 'config.json'), 'utf8')), { project_id: 'p', custom: 1, auto_accept: false });
  assert.equal(JSON.parse((await json('/api/config')).text).auto_accept, false);
  // retire.after_sessions, the one nested setting, is written in place.
  assert.equal(JSON.parse((await json('/api/config')).text).retire_after_sessions, 20);
  assert.equal((await json('/api/config', { method: 'PUT', body: JSON.stringify({ retire_after_sessions: 30 }) })).status, 200);
  assert.deepEqual(JSON.parse(readFileSync(join(root, '.dd', 'config.json'), 'utf8')).retire, { after_sessions: 30 });
  assert.equal(JSON.parse((await json('/api/config')).text).retire_after_sessions, 30);
  assert.equal((await json('/api/config', { method: 'PUT', body: JSON.stringify({ retire_after_sessions: 0 }) })).status, 400);
  writeFileSync(join(root, '.dd', 'config.json'), JSON.stringify({ project_id: 'p', custom: 1, auto_accept: false }));
  const bad = await json('/api/config', { method: 'PUT', body: JSON.stringify({ auto_accept: 'yes' }) });
  assert.equal(bad.status, 400);
  assert.ok(JSON.parse(bad.text).problems.includes('invalid_setting:auto_accept'));
  const unknown = await json('/api/config', { method: 'PUT', body: JSON.stringify({ project_id: 'other' }) });
  assert.equal(unknown.status, 400);
  assert.ok(JSON.parse(unknown.text).problems.includes('not_a_setting:project_id'));
});

test('delivery_limit is a setting with bounds, compiled into the index when changed', async t => {
  const { server, cookie, root } = await serve(t);
  const json = (path, init = {}) => call(server, path, { ...init, headers: { cookie, 'content-type': 'application/json', ...init.headers } });
  assert.equal(JSON.parse((await json('/api/config')).text).delivery_limit, 10000);
  assert.equal((await json('/api/config', { method: 'PUT', body: JSON.stringify({ delivery_limit: 1000 }) })).status, 400);
  assert.equal((await json('/api/config', { method: 'PUT', body: JSON.stringify({ delivery_limit: 5000 }) })).status, 200);
  assert.equal(JSON.parse(readFileSync(join(root, '.dd', 'local', 'v2', 'index.json'), 'utf8')).limit, 5000);
});

// Opens the live stream and collects its events until the test closes it.
function listen(server, cookie) {
  const events = [];
  const req = request({ host: '127.0.0.1', port: server.port, path: '/api/events', headers: { host: `127.0.0.1:${server.port}`, cookie } });
  const ready = new Promise((resolve, reject) => {
    req.on('response', res => {
      res.setEncoding('utf8');
      res.on('data', chunk => { for (const line of chunk.split('\n')) if (line.startsWith('data:')) events.push(line.slice(5).trim()); });
      resolve(res);
    });
    req.on('error', reject);
  });
  req.end();
  return { events, ready, close: () => req.destroy() };
}
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));

test('the page hears about a change to the store, and not about the UI\'s own reads', async t => {
  const { root, server, cookie } = await serve(t);
  assert.equal((await call(server, '/api/events')).status, 403);
  const live = listen(server, cookie);
  t.after(live.close);
  const res = await live.ready;
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const { mkdirSync } = await import('node:fs');
  mkdirSync(join(root, '.dd', 'local', 'v2'), { recursive: true });
  // macOS reports file events with a delay and can still deliver the project's own setup writes:
  // let those land, then listen from a clean slate.
  await settle(1200);
  live.events.length = 0;
  writeFileSync(join(root, '.dd', 'local', 'telemetry.sqlite-wal'), 'x');
  writeFileSync(join(root, '.dd', 'local', 'v2', 'index.json'), '{}');
  await settle(800);
  assert.deepEqual(live.events, []);
  mkdirSync(join(root, '.dd', 'local', 'requests'), { recursive: true });
  writeFileSync(join(root, '.dd', 'local', 'requests', 'r1.json'), JSON.stringify({ id: 'r1', request: 'review', target: 'm1', why: 'x' }));
  for (let i = 0; i < 30 && !live.events.length; i += 1) await settle(100);
  assert.deepEqual(live.events, ['changed']);
});
