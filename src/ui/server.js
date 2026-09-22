import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposeMemory } from '../engine/write.js';
import { admitMemory, rejectMemory, resolveMemories, restoreMemory, HUMAN_REVIEW } from '../engine/lifecycle.js';
import { projectContext } from '../engine/project-context.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';
import { recommendResolution } from '../engine/v6/predominance.js';
import { resolve as resolvePath } from 'node:path';
import { buildPreToolContext } from '../hooks/pre-tool.js';
import { recordPromptObservation } from '../hooks/observe.js';
import { buildSessionStartContext, contextPayload, microPack } from '../hooks/session-start.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { sweepAutoAccept } from '../engine/auto-accept.js';
import { autoAcceptThresholdLevels } from '../engine/reliability.js';
import { readSeen, markSeen, isSeen } from '../store/seen.js';
import { BUILD_ID, codeFingerprint, samePath } from '../hooks/build.js';
import { createSemanticRetrieve } from '../semantic/provider.js';

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

export async function startUiServer({ store, projectId, port = 7733, host = '127.0.0.1', fingerprint = codeFingerprint, staleCheckMs = 2000, semantic = false, onShutdown }) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('audit_requires_loopback');
  // A long-lived UI keeps running the code it started with. Once that tree is
  // edited it stops answering hooks, which then run the current code locally
  // (roadmap gap 7). Stale is permanent: only a restart loads the new code.
  const startedCode = await fingerprint();
  // The resident process is where embeddings can live (L2/L3). Hooks it answers
  // get semantic retrieval once the model has loaded, lexical until then.
  const retrieve = semantic ? createSemanticRetrieve({ blocking: false }) : retrieveMemories;
  let retrieval = semantic ? 'loading' : 'lexical';
  const semanticReady = semantic ? retrieve.warm({ store, projectId }).catch(() => false) : Promise.resolve(false);
  semanticReady.then(ready => { if (semantic) retrieval = ready ? 'semantic' : 'lexical'; });
  let lastActivity = Date.now();
  let codeCheckedAt = Date.now();
  let codeStale = false;
  async function staleCode() {
    if (!codeStale && Date.now() - codeCheckedAt >= staleCheckMs) {
      codeCheckedAt = Date.now();
      codeStale = await fingerprint() !== startedCode;
    }
    return codeStale;
  }
  await sweepAutoAccept({ store, projectId });
  const token = randomBytes(32).toString('hex');
  const hookToken = randomBytes(32).toString('hex');
  // The audit UI is the one place in the plugin that is already a persistent
  // local process whenever it runs (L2), with a person actually watching the
  // page — so it can push instead of making the tab poll or the person reload.
  // Nothing else in the plugin gets this: hooks are ephemeral (L1) and the MCP
  // server has no screen to push to.
  const sseClients = new Set();
  function broadcastChanged() {
    const message = 'event: changed\ndata: {}\n\n';
    for (const client of sseClients) { try { client.write(message); } catch { sseClients.delete(client); } }
  }
  const unsubscribeChanges = store.onChange?.(broadcastChanged);
  const server = createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      const expectedHost = `${host}:${actualPort}`;
      if (req.headers.host !== expectedHost) return send(res, 403, { error: 'invalid_host' });
      const url = new URL(req.url, `http://${expectedHost}`);
      // A resident from a newer build asks this one to step aside.
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        if (req.headers['x-dd-hook-token'] !== hookToken || !onShutdown) return send(res, 403, { error: 'hook_auth_required' });
        send(res, 200, { ok: true });
        return void setImmediate(onShutdown);
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/hooks/')) {
        if (req.headers['x-dd-hook-token'] !== hookToken) return send(res, 403, { error: 'hook_auth_required' });
        if (await staleCode()) return send(res, 409, { error: 'build_stale' });
        lastActivity = Date.now();
        res.setHeader('x-dd-build', BUILD_ID);
        const body = await readBody(req);
        if (!samePath(body.repo_root ?? '', store.repoRoot)) return send(res, 403, { error: 'project_mismatch' });
        await store.refreshIfChanged();
        const payload = body.payload ?? {};
        if (url.pathname.endsWith('/pre-tool')) return send(res, 200, await buildPreToolContext(payload, { store, projectId, retrieve }));
        if (url.pathname.endsWith('/session-start')) return send(res, 200, await buildSessionStartContext({ store, projectId, uiUrl: `http://${expectedHost}`,
          // This request is being served by the audit UI, so it is live by construction.
          uiLive: true, sessionId: payload.session_id ?? payload.sessionId, source: payload.source,
          resident: { state: 'live', retrieval: retrieval === 'loading' ? 'semantic' : retrieval } }));
        if (url.pathname.endsWith('/prompt')) {
          await store.beginCaptureTurn(projectId, payload.session_id ?? payload.sessionId);
          await recordPromptObservation(payload, { store, projectId });
          const result = await retrieve({ project_id: projectId, action: payload.prompt || payload.text || payload.user_prompt,
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
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
          connection: 'keep-alive', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'" });
        res.write(':ok\n\n');
        sseClients.add(res);
        // A pure keep-alive so an idle intermediary (or the browser) never
        // times the connection out; it carries no event name, so the page's
        // 'changed' listener never fires on it.
        const heartbeat = setInterval(() => { try { res.write(':hb\n\n'); } catch { /* handled by close below */ } }, 25000);
        req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
        return;
      }
      await store.refreshIfChanged();
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(res, 200, { project_id: projectId, build: BUILD_ID, stale: await staleCode(), retrieval, ...await store.countByLifecycle(projectId) });
      }
      if (req.method === 'GET' && url.pathname === '/api/project') return send(res, 200, await projectContext(store));
      if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, await store.assessDeterioration(projectId));
      if (req.method === 'GET' && url.pathname === '/api/observations') return send(res, 200, await store.listObservations(projectId));
      if (req.method === 'GET' && url.pathname === '/api/feedback') return send(res, 200, await store.listFeedback(projectId, url.searchParams.get('atom')));
      if (req.method === 'POST' && url.pathname === '/api/feedback/review') {
        const body = await readBody(req);
        if (typeof body.accepted !== 'boolean') throw new Error('accepted_boolean_required');
        await store.reviewFeedback(body.id, projectId, body.accepted);
        return send(res, 200, { reviewed: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const config = await store.loadConfig();
        return send(res, 200, { auto_accept: config.auto_accept, auto_accept_threshold_levels: autoAcceptThresholdLevels() });
      }
      if (req.method === 'POST' && url.pathname === '/api/config/auto-accept') {
        const body = await readBody(req);
        if (typeof body.enabled !== 'boolean') throw new Error('enabled_boolean_required');
        if (typeof body.confidence_threshold !== 'number' || body.confidence_threshold < 0 || body.confidence_threshold > 1) {
          throw new Error('confidence_threshold_must_be_0_to_1');
        }
        const config = await store.loadConfig();
        config.auto_accept = { enabled: body.enabled, confidence_threshold: body.confidence_threshold };
        await store.saveConfig(config);
        return send(res, 200, { auto_accept: config.auto_accept });
      }
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        await sweepAutoAccept({ store, projectId });
        const lifecycle = url.searchParams.get('lifecycle');
        const origin = url.searchParams.get('capture_origin');
        const memoryType = url.searchParams.get('memory_type');
        const atoms = await store.listAtoms({ projectId, lifecycleStates: lifecycle ? [lifecycle] : undefined });
        const seen = await readSeen();
        return send(res, 200, await Promise.all(atoms.filter(atom => !origin || atom.capture_origin === origin)
          .filter(atom => !memoryType || atom.memory_type === memoryType)
          // Lifecycle stays 'active' when cited evidence changes; retrieval flags
          // it. Surfaced here so the list does not look healthier than it is.
          .map(async atom => ({ ...atom, seen: isSeen(atom.id, seen),
            ...(['active', 'contested'].includes(atom.lifecycle_state) && (await checkEvidenceFreshness(atom, store)).length
              ? { evidence_changed: true } : {}) }))));
      }
      if (req.method === 'POST' && url.pathname === '/api/resolve') {
        const body = await readBody(req);
        return send(res, 200, await resolveMemories(body.winner_id, body.loser_id,
          { store, projectId, actor: HUMAN_REVIEW, rationale: body.rationale }));
      }
      const match = url.pathname.match(/^\/api\/atoms\/([^/]+)(?:\/(admit|reject|restore))?$/);
      if (match) {
        const id = decodeURIComponent(match[1]);
        const action = match[2];
        const atom = await store.getAtom(id, projectId);
        if (!atom) return send(res, 404, { error: 'not_found' });
        if (req.method === 'GET') {
          await markSeen(atom.id);
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
          return send(res, 200, { ...atom, seen: true, freshness: await checkEvidenceFreshness(atom, store), relations, opponents });
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
        if (req.method === 'POST' && action === 'restore') return send(res, 200, await restoreMemory(id, { store, projectId, actor: HUMAN_REVIEW }));
      }
      send(res, 404, { error: 'not_found' });
    } catch (err) { send(res, 409, { error: err.message }); }
  });
  return new Promise((resolve, reject) => {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && port > 0 && port < 7743) return resolve(startUiServer({ store, projectId, port: port + 1, host, fingerprint, staleCheckMs, semantic, onShutdown }));
      reject(err);
    });
    server.listen(port, host, () => resolve({ port: server.address().port, url: `http://${host}:${server.address().port}`, hookToken, semanticReady, idleFor: () => Date.now() - lastActivity,
      close: () => new Promise(done => {
        for (const client of sseClients) { try { client.end(); } catch { /* already gone */ } }
        sseClients.clear();
        unsubscribeChanges?.();
        server.close(done);
      }) }));
  });
}
