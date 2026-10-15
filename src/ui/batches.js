import { localPaths } from '../engine/locate.cjs';
import { createMemoryFiles } from '../memory/store.js';
import { listRequests } from './requests.js';

// A batch is the lot an agent named on its proposals and requests, so a person can
// accept or reject them in one action instead of one by one. It groups what still
// waits: pending candidates (review.batch) and open requests (batch).
export const BATCH = /^[A-Za-z0-9_-]{1,64}$/;

export async function listBatches(root) {
  const memories = await createMemoryFiles(localPaths(root).dd).list();
  const batches = new Map();
  const of = name => {
    if (!batches.has(name)) batches.set(name, { name, candidates: [], requests: [] });
    return batches.get(name);
  };
  for (const memory of memories) {
    if (memory.status === 'candidate' && typeof memory.review?.batch === 'string') {
      of(memory.review.batch).candidates.push({ id: memory.id, topic: memory.topic, kind: memory.kind, title: memory.title });
    }
  }
  for (const request of listRequests(root)) if (typeof request.batch === 'string') of(request.batch).requests.push(request);
  return [...batches.values()].sort((a, b) => a.name.localeCompare(b.name));
}
