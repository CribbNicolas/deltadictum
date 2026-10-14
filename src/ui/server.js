import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { acceptMemory, archiveMemory, createMemory, deleteMemory, editMemory, markReviewed, mergeMemories, rejectMemory, restoreMemory, retopicMemory, ReviewError } from './actions.js';
import { dryRun } from './dry-run.js';
import { closeRequest, listRequests } from './requests.js';
import { listMemories, memoryDetail, overview, QUEUES } from './views.js';

// The review UI (spec section 8), started by a person, for one project. Anyone on
// the machine can reach a loopback port: the UI answers only its own Host, only a
// browser holding its key (traded once for a SameSite=Strict cookie), runs only
// scripts with the page's nonce, and accepts mutations only as JSON, which a
// cross-site form cannot send.
const PAGE = fileURLToPath(new URL('./public/review.html', import.meta.url));

function send(res, status, body, type = 'application/json', nonce = null) {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'content-security-policy': `default-src 'self'; script-src ${nonce ? `'nonce-${nonce}'` : "'none'"}; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookieOf(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

async function bodyOf(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 256000) throw new ReviewError(['request_too_large']);
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}; } catch { throw new ReviewError(['invalid_json']); }
}

async function route(root, req, url, body) {
  const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
  const [area, id, action] = parts;
  if (req.method === 'GET' && area === 'overview') return overview(root);
  if (req.method === 'GET' && area === 'requests') return listRequests(root);
  if (req.method === 'POST' && area === 'requests' && parts.length === 3) return closeRequest(root, id, action);
  if (req.method === 'POST' && area === 'merge') return mergeMemories(root, body.keep, body.drop);
  if (area !== 'memories') return undefined;
  if (!id && req.method === 'GET') {
    const queue = url.searchParams.get('queue') ?? 'all';
    if (!QUEUES.includes(queue)) throw new ReviewError(['unknown_queue']);
    return listMemories(root, { queue });
  }
  if (!id && req.method === 'POST') return createMemory(root, body);
  if (id && !action) {
    if (req.method === 'GET') {
      const detail = await memoryDetail(root, id);
      if (!detail) throw new ReviewError(['memory_not_found']);
      return detail;
    }
    if (req.method === 'PUT') return editMemory(root, id, body);
    if (req.method === 'DELETE') return { deleted: await deleteMemory(root, id) };
  }
  if (id && req.method === 'POST') {
    if (action === 'accept') return acceptMemory(root, id);
    if (action === 'reject') return rejectMemory(root, id, body.reason);
    if (action === 'archive') return archiveMemory(root, id, body.reason);
    if (action === 'restore') return restoreMemory(root, id);
    if (action === 'reviewed') return markReviewed(root, id);
    if (action === 'retopic') return retopicMemory(root, id, body.topic);
    if (action === 'dry-run') {
      const triggers = Array.isArray(body.triggers) ? body.triggers : (await memoryDetail(root, id))?.memory.triggers ?? [];
      return dryRun(root, triggers);
    }
  }
  return undefined;
}

export async function startReviewServer({ root, port = 0, host = '127.0.0.1' }) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('review_ui_requires_loopback');
  const key = randomBytes(16).toString('hex');
  const server = createServer(async (req, res) => {
    try {
      const actual = server.address().port;
      if (req.headers.host !== `${host}:${actual}`) return send(res, 403, { error: 'invalid_host' });
      const url = new URL(req.url, `http://${host}:${actual}`);
      const cookieName = `dd_review_${actual}`;
      if (req.method === 'GET' && url.pathname === '/' && url.searchParams.has('key')) {
        if (!sameSecret(url.searchParams.get('key'), key)) return send(res, 403, { error: 'key_required' });
        res.writeHead(303, { location: '/', 'set-cookie': `${cookieName}=${key}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
        return res.end();
      }
      if (!sameSecret(cookieOf(req, cookieName), key)) return send(res, 403, { error: 'key_required' });
      if (req.method === 'GET' && url.pathname === '/') {
        const nonce = randomBytes(16).toString('hex');
        return send(res, 200, (await readFile(PAGE, 'utf8')).replaceAll('__NONCE__', nonce), 'text/html', nonce);
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not_found' });
      if (req.method !== 'GET' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) return send(res, 415, { error: 'json_required' });
      const result = await route(root, req, url, req.method === 'GET' ? {} : await bodyOf(req));
      return result === undefined ? send(res, 404, { error: 'not_found' }) : send(res, 200, result);
    } catch (err) {
      if (err instanceof ReviewError) return send(res, err.problems.includes('memory_not_found') ? 404 : 400, { error: 'refused', problems: err.problems });
      if (err instanceof URIError) return send(res, 400, { error: 'refused', problems: ['invalid_path'] });
      if (['request_not_found', 'invalid_outcome'].includes(err?.message)) return send(res, 400, { error: 'refused', problems: [err.message] });
      return send(res, 500, { error: 'internal', message: String(err?.message ?? err).slice(0, 200) });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actual = server.address().port;
  return {
    port: actual, key, url: `http://${host}:${actual}/?key=${key}`,
    close: () => new Promise(resolve => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}
