import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposeMemory } from '../engine/write.js';
import { decideAdmission } from '../engine/v2/admission.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

function send(res, status, body, type = 'application/json') {
  const payload = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, {
    'content-type': `${type}; charset=utf-8`,
    'cache-control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function startUiServer({ store, projectId, port = 7733, host = '127.0.0.1' }) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${host}:${port}`);
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const html = await readFile(join(ROOT, 'public', 'index.html'), 'utf8');
        return send(res, 200, html, 'text/html');
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const total = await store.countAtoms({ projectId });
        return send(res, 200, { project_id: projectId, total });
      }
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        const lifecycle = url.searchParams.get('lifecycle');
        const atoms = await store.listAtoms({
          projectId,
          lifecycleStates: lifecycle ? [lifecycle] : undefined,
        });
        return send(res, 200, atoms);
      }
      const atomMatch = url.pathname.match(/^\/api\/atoms\/([^/]+)(?:\/(admit|reject))?$/);
      if (atomMatch) {
        const id = decodeURIComponent(atomMatch[1]);
        const action = atomMatch[2];
        const atom = await store.getAtom(id, projectId);
        if (!atom) return send(res, 404, { error: 'not_found' });
        if (req.method === 'GET' && !action) return send(res, 200, atom);
        if (req.method === 'DELETE' && !action) {
          if (atom.authority === 'canonical' && url.searchParams.get('confirm') !== 'true') {
            return send(res, 409, { error: 'canonical_confirm_required' });
          }
          await store.deleteAtom(atom);
          return send(res, 200, { deleted: true, id });
        }
        if (req.method === 'PATCH' && !action) {
          const patch = await readBody(req);
          const result = await proposeMemory({ ...atom, ...patch, id: atom.id, project_id: projectId }, { store });
          return send(res, 200, result);
        }
        if (req.method === 'POST' && action === 'admit') {
          const gate = decideAdmission(atom);
          if (gate.decision !== 'write' && gate.decision !== 'update') {
            return send(res, 409, { error: 'cannot_admit', reasons: gate.reasons });
          }
          const stored = await store.putAtom({ ...atom, lifecycle_state: 'active' });
          return send(res, 200, stored);
        }
        if (req.method === 'POST' && action === 'reject') {
          const stored = await store.putAtom({ ...atom, lifecycle_state: 'rejected' });
          return send(res, 200, stored);
        }
      }
      send(res, 404, { error: 'not_found' });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE' && port < 7743) {
        resolve(startUiServer({ store, projectId, port: port + 1, host }));
        return;
      }
      reject(err);
    });
    server.listen(port, host, () => {
      resolve({
        port: server.address().port,
        url: `http://${host}:${server.address().port}`,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}
