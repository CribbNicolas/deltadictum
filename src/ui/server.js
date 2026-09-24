import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposeMemory } from '../engine/write.js';
import { admitMemory, rejectMemory, resolveMemories, restoreMemory, HUMAN_REVIEW } from '../engine/lifecycle.js';
import { projectContext } from '../engine/project-context.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';
import { recommendResolution } from '../engine/v6/predominance.js';
import { buildPreToolContext } from '../hooks/pre-tool.js';
import { recordPromptObservation } from '../hooks/observe.js';
import { buildSessionStartContext, contextPayload, microPack } from '../hooks/session-start.js';
import { uiPointer } from '../hooks/banner.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { sweepAutoAccept } from '../engine/auto-accept.js';
import { autoAcceptThresholdLevels } from '../engine/reliability.js';
import { readSeen, markSeen, isSeen } from '../store/seen.js';
import { BUILD_ID, VERSION, codeFingerprint } from '../hooks/build.js';
import { projectKey } from '../project.js';
import { revisionNotices } from '../engine/revisions.js';
import { createSemanticRetrieve } from '../semantic/provider.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
// Scripts run only with the nonce of the page that carries them, so markup an
// escaping mistake let into the page cannot execute. Styles stay inline.
function send(res, status, body, type = 'application/json', scriptNonce = null) {
  const scripts = scriptNonce ? `'nonce-${scriptNonce}'` : "'none'";
  res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'content-security-policy': `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 64000) throw new Error('request_too_large'); chunks.push(chunk); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

// Lines for the person, each shown at most once per session, on the first
// prompt this resident answers: the audit UI address, when no session start
// named it (the session began before this resident listened), and that DD is
// now active, when its session start said the model was still loading.
const UI_POINTER = '__dd_ui_pointer__';
const LOADING_NOTICE = '__dd_loading__';
async function sessionNotes(store, projectId, sessionId, uiUrl, active) {
  const notes = [];
  if (active && await store.wasDelivered(projectId, sessionId, LOADING_NOTICE, 'shown')
      && await store.claimDelivery(projectId, sessionId, LOADING_NOTICE, 'ready')) notes.push('DD is active: its embedding model is loaded.');
  if (await store.claimDelivery(projectId, sessionId, UI_POINTER, 'shown')) notes.push(uiPointer(uiUrl));
  return notes;
}

// Secrets are compared in constant time; a missing or malformed one never matches.
function sameSecret(given, expected) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cookie(req, name) {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}

export function inactiveMessage(retrieval) {
  return retrieval === 'loading'
    ? 'DD is starting: its embedding model is loading, and DD stays inactive until it is ready.'
    : 'DD is inactive: the resident process could not load its embedding model. See README > "Resident process".';
}

// The resident server: one process serves every project it is asked about, each
// from its own store, with one embedding model shared by all of them (L2/L3).
// With `semantic`, DD is inactive until that model is ready: hooks inject
// nothing and SessionStart says why (embeddings are required). Without it
// (tests, evaluation) retrieval is lexical.
export async function startResidentServer({ projects: initial = [], openProject, port = 7733, host = '127.0.0.1', fingerprint = codeFingerprint,
  staleCheckMs = 2000, semantic = false, onShutdown, createRetrieve = () => createSemanticRetrieve({ blocking: false }), sharedRetrieve, attempt = 0 }) {
  if (!['127.0.0.1', '::1', 'localhost'].includes(host)) throw new Error('audit_requires_loopback');
  // A long-lived resident keeps running the code it started with. Once that tree
  // is edited it stops answering hooks, and a current one replaces it at the
  // next session start (roadmap gap 7). Stale is permanent.
  const startedCode = await fingerprint();
  // Created once and handed to a retry on a busy port: each instance holds its
  // own model (~500 MB), so one per attempt multiplied the process's memory.
  const retrieve = sharedRetrieve ?? (semantic ? createRetrieve() : retrieveMemories);
  let retrieval = semantic ? 'loading' : 'lexical';
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
  const token = randomBytes(32).toString('hex');
  const hookToken = randomBytes(32).toString('hex');
  // Anyone on the machine can connect to a loopback port, including other
  // accounts. The audit UI and its API answer only a browser holding this key:
  // it reaches the person in the address hooks print, read from the owner-only
  // registry, and is traded for a cookie on the first visit.
  const uiKey = randomBytes(32).toString('hex');
  const withKey = address => `${address}&key=${uiKey}`;

  // Projects by key (src/project.js projectKey). The audit UI is the one place in
  // the plugin that is a persistent process with a person watching (L2), so it
  // pushes changes to each project's open pages instead of making them poll.
  const projects = new Map();
  let semanticReady = Promise.resolve(false);
  async function addProject({ store, projectId, owned = false }) {
    const key = projectKey(store.repoRoot).key;
    if (projects.has(key)) return projects.get(key);
    const entry = { key, store, projectId, owned, sse: new Set() };
    entry.unsubscribe = store.onChange?.(() => {
      for (const client of entry.sse) { try { client.write('event: changed\ndata: {}\n\n'); } catch { entry.sse.delete(client); } }
    });
    projects.set(key, entry);
    await sweepAutoAccept({ store, projectId });
    if (semantic) {
      // The model loads once; each project only embeds its own memories.
      const warmed = retrieve.warm({ store, projectId }).catch(() => false);
      semanticReady = warmed;
      warmed.then(ready => { if (retrieval !== 'semantic') retrieval = ready ? 'semantic' : 'unavailable'; });
    }
    return entry;
  }
  if (semantic && retrieve.preload) {
    semanticReady = retrieve.preload().catch(() => false);
    semanticReady.then(ready => { if (retrieval !== 'semantic') retrieval = ready ? 'semantic' : 'unavailable'; });
  }
  for (const project of initial) await addProject(project);

  async function hookProject(body) {
    const repoRoot = body.repo_root ?? '';
    if (!repoRoot) return null;
    const known = projects.get(projectKey(repoRoot).key);
    if (known) return known;
    if (!openProject) return null;
    return addProject({ ...await openProject(repoRoot, body.data_dir), owned: true });
  }
  function uiProject(url) {
    const key = url.searchParams.get('project');
    if (key) return projects.get(key) ?? null;
    return projects.size === 1 ? [...projects.values()][0] : null;
  }

  const server = createServer(async (req, res) => {
    try {
      const actualPort = server.address().port;
      const expectedHost = `${host}:${actualPort}`;
      if (req.headers.host !== expectedHost) return send(res, 403, { error: 'invalid_host' });
      const url = new URL(req.url, `http://${expectedHost}`);
      // A resident from a newer build asks this one to step aside.
      if (req.method === 'POST' && url.pathname === '/api/shutdown') {
        if (!sameSecret(req.headers['x-dd-hook-token'], hookToken) || !onShutdown) return send(res, 403, { error: 'hook_auth_required' });
        send(res, 200, { ok: true });
        return void setImmediate(onShutdown);
      }
      if (req.method === 'GET' && url.pathname === '/api/resident') {
        return send(res, 200, { build: BUILD_ID, version: VERSION, stale: await staleCode(), retrieval, projects: projects.size });
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/hooks/')) {
        if (!sameSecret(req.headers['x-dd-hook-token'], hookToken)) return send(res, 403, { error: 'hook_auth_required' });
        if (await staleCode()) return send(res, 409, { error: 'build_stale' });
        lastActivity = Date.now();
        res.setHeader('x-dd-build', BUILD_ID);
        if (VERSION) res.setHeader('x-dd-version', VERSION);
        const body = await readBody(req);
        const project = await hookProject(body);
        if (!project) return send(res, 403, { error: 'project_mismatch' });
        const { store, projectId, key } = project;
        await store.refreshIfChanged();
        const payload = body.payload ?? {};
        const uiUrl = withKey(`http://${expectedHost}/?project=${encodeURIComponent(key)}`);
        const active = retrieval !== 'loading' && retrieval !== 'unavailable';
        const sessionId = payload.session_id ?? payload.sessionId;
        if (url.pathname.endsWith('/session-start')) {
          const context = await buildSessionStartContext({ store, projectId, uiUrl,
            // This request is being served by the resident, so it is live by construction.
            uiLive: true, sessionId, source: payload.source, resident: { state: 'live', retrieval } });
          // The session start names the audit UI; the first prompt need not.
          if (sessionId) await store.markDelivered(projectId, sessionId, UI_POINTER, 'shown');
          if (sessionId && !active) await store.markDelivered(projectId, sessionId, LOADING_NOTICE, 'shown');
          return send(res, 200, context);
        }
        if (url.pathname.endsWith('/prompt')) {
          await store.beginCaptureTurn(projectId, sessionId);
          await recordPromptObservation(payload, { store, projectId });
          const notes = sessionId ? await sessionNotes(store, projectId, sessionId, uiUrl, active) : [];
          const shown = notes.length ? { systemMessage: notes.join('\n') } : {};
          // A reviewer's revision request needs no embeddings: it is said even while the model loads.
          const revisions = await revisionNotices({ store, projectId, sessionId }).catch(() => null);
          if (!active) return send(res, 200, { ...shown, ...contextPayload('UserPromptSubmit', revisions) });
          const result = await retrieve({ project_id: projectId, action: payload.prompt || payload.text || payload.user_prompt,
            session_id: sessionId, budget_tokens: payload.budget_tokens }, { store });
          return send(res, 200, { ...shown,
            ...contextPayload('UserPromptSubmit', [revisions, microPack(result.memories ?? [])].filter(Boolean).join('\n')) });
        }
        if (url.pathname.endsWith('/pre-tool')) return send(res, 200, active ? await buildPreToolContext(payload, { store, projectId, retrieve }) : {});
        if (url.pathname.endsWith('/similar')) {
          if (!active || !retrieve.similar) return send(res, 200, { error: { code: 503, message: inactiveMessage(retrieval) } });
          return send(res, 200, await retrieve.similar({ store, projectId, id: payload.id, text: payload.text, limit: payload.limit }));
        }
        if (url.pathname.endsWith('/retrieve')) {
          if (!active) return send(res, 200, { error: { code: 503, message: inactiveMessage(retrieval) } });
          const context = await projectContext(store);
          return send(res, 200, await retrieve({ ...payload, project_id: projectId, facts: { ...payload.facts, ...context.facts } }, { store }));
        }
        return send(res, 404, { error: 'unknown_hook' });
      }
      // The key in an address becomes a cookie scoped to this port, and the
      // address is reloaded without it, out of the history and the referrer.
      const sessionCookie = `dd_ui_${actualPort}`;
      if (req.method === 'GET' && url.searchParams.has('key')) {
        if (!sameSecret(url.searchParams.get('key'), uiKey)) return send(res, 403, { error: 'ui_key_required' });
        url.searchParams.delete('key');
        res.writeHead(303, { location: url.pathname + url.search, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer',
          'set-cookie': `${sessionCookie}=${uiKey}; HttpOnly; SameSite=Strict; Path=/` });
        return res.end();
      }
      if (!sameSecret(cookie(req, sessionCookie), uiKey)) {
        return send(res, 403, { error: 'ui_key_required', message: 'Open the audit UI through the address DD prints at session start, or the dd `ui` tool.' });
      }
      if (req.method !== 'GET' && (!sameSecret(req.headers['x-dd-review-token'], token)
          || (req.headers.origin && req.headers.origin !== `http://${expectedHost}`))) return send(res, 403, { error: 'local_review_required' });
      if (req.method === 'GET' && ['/', '/index.html'].includes(url.pathname)) {
        const nonce = randomBytes(16).toString('base64');
        const html = (await readFile(join(ROOT, 'public', 'index.html'), 'utf8')).replace('__DD_REVIEW_TOKEN__', token)
          .replace(/<script>/g, `<script nonce="${nonce}">`);
        return send(res, 200, html, 'text/html', nonce);
      }
      if (req.method === 'GET' && url.pathname === '/api/projects') {
        return send(res, 200, [...projects.values()].map(p => ({ key: p.key, project_id: p.projectId, repo_root: p.store.repoRoot })));
      }
      const project = uiProject(url);
      if (!project) {
        const named = url.searchParams.get('project');
        return send(res, named ? 404 : 400, { error: named ? 'unknown_project' : 'project_required' });
      }
      const { store, projectId } = project;
      if (req.method === 'GET' && url.pathname === '/api/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store',
          connection: 'keep-alive', 'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; frame-ancestors 'none'" });
        res.write(':ok\n\n');
        project.sse.add(res);
        // A pure keep-alive so an idle intermediary (or the browser) never
        // times the connection out; it carries no event name, so the page's
        // 'changed' listener never fires on it.
        const heartbeat = setInterval(() => { try { res.write(':hb\n\n'); } catch { /* handled by close below */ } }, 25000);
        req.on('close', () => { clearInterval(heartbeat); project.sse.delete(res); });
        return;
      }
      await store.refreshIfChanged();
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return send(res, 200, { project_id: projectId, project_key: project.key, build: BUILD_ID, stale: await staleCode(), retrieval,
          ...await store.countByLifecycle(projectId), unsupported: await store.listUnsupported() });
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
  function closeAll() {
    for (const project of projects.values()) {
      for (const client of project.sse) { try { client.end(); } catch { /* already gone */ } }
      project.sse.clear();
      project.unsubscribe?.();
      if (project.owned) project.store.close();
    }
  }
  return new Promise((resolve, reject) => {
    server.on('error', err => {
      // A busy port moves to the next one, ten times at most. Port 0 asks the OS.
      if (err.code === 'EADDRINUSE' && port > 0 && attempt < 9) {
        for (const project of projects.values()) project.unsubscribe?.();
        return resolve(startResidentServer({ projects: initial, openProject, port: port + 1, host, fingerprint, staleCheckMs, semantic,
          onShutdown, createRetrieve, sharedRetrieve: retrieve, attempt: attempt + 1 }));
      }
      reject(err);
    });
    server.listen(port, host, () => resolve({ port: server.address().port, url: `http://${host}:${server.address().port}`, hookToken, uiKey,
      get semanticReady() { return semanticReady; }, idleFor: () => Date.now() - lastActivity, projects,
      projectUrl: repoRoot => withKey(`http://${host}:${server.address().port}/?project=${encodeURIComponent(projectKey(repoRoot).key)}`),
      close: () => new Promise(done => { closeAll(); server.close(done); }) }));
  });
}

// One project, in-process: the audit UI for the store it is given. Kept for
// single-project use and for tests.
export function startUiServer({ store, projectId, ...options }) {
  return startResidentServer({ ...options, projects: [{ store, projectId }] });
}
