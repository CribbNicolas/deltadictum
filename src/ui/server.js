import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposeMemory } from '../engine/write.js';
import { admitMemory, rejectMemory, resolveMemories, HUMAN_REVIEW } from '../engine/lifecycle.js';
import { projectContext } from '../engine/project-context.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';
import { recommendResolution } from '../engine/v6/predominance.js';
import { resolve as resolvePath } from 'node:path';
import { buildPreToolContext } from '../hooks/pre-tool.js';
import { recordPromptObservation } from '../hooks/observe.js';
import { buildSessionStartContext, contextPayload, microPack } from '../hooks/session-start.js';
import { retrieveMemories } from '../engine/retrieve.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 64000) throw new Error('request_too_large'); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export function startUiServer({ store, projectId, port = 7733, host = '127.0.0.1' }) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('audit_requires_loopback');
  const token = randomBytes(32).toString('hex');
  const hookToken = randomBytes(32).toString('hex');
  const server = createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      const expectedHost = `${host}:${actualPort}`;
      if (req.headers.host !== expectedHost) return send(res, 403, { error: 'invalid_host' });
      const url = new URL(req.url, `http://${expectedHost}`);
      if (req.method === 'POST' && url.pathname.startsWith('/api/hooks/')) {
        if (req.headers['x-dd-hook-token'] !== hookToken) return send(res, 403, { error: 'hook_auth_required' });
        const body = await readBody(req);
        if (resolvePath(body.repo_root ?? '') !== resolvePath(store.repoRoot)) return send(res, 403, { error: 'project_mismatch' });
        await store.refreshIfChanged();
        const payload = body.payload ?? {};
        if (url.pathname.endsWith('/pre-tool')) return send(res, 200, await buildPreToolContext(payload, { store, projectId }));
        if (url.pathname.endsWith('/session-start')) return send(res, 200, await buildSessionStartContext({ store, projectId, uiUrl: `http://${expectedHost}`,
          sessionId: payload.session_id ?? payload.sessionId, source: payload.source }));
        if (url.pathname.endsWith('/prompt')) {
          await store.beginCaptureTurn(projectId, payload.session_id ?? payload.sessionId);
          await recordPromptObservation(payload, { store, projectId });
          const result = await retrieveMemories({ project_id: projectId, action: payload.prompt || payload.text || payload.user_prompt,
            session_id: payload.session_id ?? payload.sessionId, budget_tokens: payload.budget_tokens }, { store });
          return send(res, 200, contextPayload('UserPromptSubmit', microPack(result.memories ?? [])));
        }
        return send(res, 404, { error: 'unknown_hook' });
      }
      if (req.method !== 'GET' && (req.headers['x-dd-review-token'] !== token
          || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`))) return send(res, 403, { error: 'local_review_required' });
      if (req.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
        const html = (await readFile(join(ROOT, 'public', 'index.html'), 'utf8')).replace('__DD_REVIEW_TOKEN__', token);
        return send(res, 200, html, 'text/html');
      }
      await store.refreshIfChanged();
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(res, 200, { project_id: projectId, ...await store.countByLifecycle(projectId) });
      }
      if (req.method === 'GET' && url.pathname === '/api/project') return send(res, 200, await projectContext(store));
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, await store.assessDeterioration(projectId));
      if (req.method === 'GET' && url.pathname === '/api/feedback') return send(res, 200, await store.listFeedback(projectId, url.searchParams.get('atom')));
      if (req.method === 'POST' && url.pathname === '/api/feedback/review') {
        const body = await readBody(req);
        if (typeof body.accepted !== 'boolean') throw new Error('accepted_boolean_required');
        await store.reviewFeedback(body.id, projectId, body.accepted);
        return send(res, 200, { reviewed: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        const lifecycle = url.searchParams.get('lifecycle');
        const origin = url.searchParams.get('capture_origin');
        const atoms = await store.listAtoms({ projectId, lifecycleStates: lifecycle ? [lifecycle] : undefined });
        return send(res, 200, atoms.filter(atom => !origin || atom.capture_origin === origin));
      }
      if (req.method === 'POST' && url.pathname === '/api/resolve') {
        const body = await readBody(req);
        return send(res, 200, await resolveMemories(body.winner_id, body.loser_id,
          { store, projectId, actor: HUMAN_REVIEW, rationale: body.rationale }));
      }
      const match = url.pathname.match(/^\/api\/atoms\/([^/]+)(?:\/(admit|reject))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        const atom = await store.getAtom(id, projectId);
        if (!atom) return send(res, 404, { error: 'not_found' });
        if (req.method === 'GET') {
          const relations = await store.listRelations({ atomIds: [atom.id] });
          const ids = relations.filter(r => r.relation_type === 'contradicts')
            .map(r => r.source_atom_id === atom.id ? r.target_atom_id : r.source_atom_id);
          // The ranking order is shown to the reviewer as a recommendation with
          // the tier that decided it. Resolution stays a human choice: nothing
          // here selects a winner.
          const opponents = (await Promise.all(ids.map(peerId => store.getAtom(peerId, projectId))))
            .filter(a => a && ['active', 'contested'].includes(a.lifecycle_state))
            .map(a => ({ id: a.id, title: a.title, topic_key: a.topic_key,
              recommendation: recommendResolution(atom, a) }));
          return send(res, 200, { ...atom, freshness: await checkEvidenceFreshness(atom, store), relations, opponents });
        }
        const body = await readBody(req);
        if (req.method === 'DELETE' && !action) {
          if (atom.authority === 'canonical' && body.confirm !== true) return send(res, 409, { error: 'canonical_confirm_required' });
          await store.deleteAtom(atom);
          return send(res, 200, { deleted: true, id });
        }
        if (req.method === 'PATCH' && !action) return send(res, 200, await proposeMemory({ ...atom, ...body, project_id: projectId },
          { store, captureSource: 'local_ui' }));
        if (req.method === 'POST' && action === 'admit') return send(res, 200, await admitMemory(id,
          { store, projectId, actor: HUMAN_REVIEW, rationale: body.rationale, authority: body.authority }));
        if (req.method === 'POST' && action === 'reject') return send(res, 200, await rejectMemory(id, { store, projectId, actor: HUMAN_REVIEW }));
      }
      send(res, 404, { error: 'not_found' });
    } catch (err) { send(res, 409, { error: err.message }); }
  });
  return new Promise((resolve, reject) => {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && port > 0 && port < 7743) return resolve(startUiServer({ store, projectId, port: port + 1, host }));
      reject(err);
    });
    server.listen(port, host, () => resolve({ port: server.address().port, url: `http://${host}:${server.address().port}`, hookToken,
      close: () => new Promise(done => server.close(done)) }));
  });
}
