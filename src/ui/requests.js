import { appendFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { localPaths } from '../engine/locate.cjs';

// Requests the agent made through the inbox (spec section 7): they wait here for
// a person, who acts on the memory and closes the request.
const dirOf = root => join(localPaths(root).local, 'requests');
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function listRequests(root) {
  let names = [];
  try { names = readdirSync(dirOf(root)).filter(name => name.endsWith('.json')); } catch { return []; }
  return names.map(name => { try { return JSON.parse(readFileSync(join(dirOf(root), name), 'utf8')); } catch { return null; } })
    .filter(request => request && typeof request.id === 'string');
}

export function closeRequest(root, id, outcome) {
  if (!['done', 'dismissed'].includes(outcome)) throw new Error('invalid_outcome');
  if (!ID.test(String(id)) || !listRequests(root).some(request => request.id === id)) throw new Error('request_not_found');
  rmSync(join(dirOf(root), `${id}.json`), { force: true });
  appendFileSync(join(dirOf(root), 'closed.jsonl'), `${JSON.stringify({ id, outcome, at: new Date().toISOString() })}\n`);
  return { id, outcome };
}
