import { HUMAN_REVIEW } from './lifecycle.js';

// A reviewer's "not yet, change this" on a pending memory or action. The item
// stays pending and cannot be admitted or applied; the reason reaches the agent
// through the prompt and session-start hooks (never PreToolUse, L1), once per
// session, and the agent answers with a corrected version carrying `revises`.
export async function requestRevision({ kind, id, reason }, { store, projectId, actor } = {}) {
  if (actor !== HUMAN_REVIEW) throw new Error('human_review_required');
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('revision_reason_required');
  const revision_requested = { reason: text.slice(0, 2000), at: new Date().toISOString() };
  if (kind === 'action') {
    const action = await store.getAction(id);
    if (!action || action.project_id !== projectId) throw new Error('action_not_found');
    return store.putAction({ ...action, revision_requested });
  }
  const atom = await store.getAtom(id, projectId);
  if (!atom || atom.lifecycle_state !== 'candidate') throw new Error('candidate_required');
  return store.putAtom({ ...atom, revision_requested });
}

export async function openRevisionRequests(store, projectId) {
  const memories = (await store.listAtoms({ projectId, lifecycleStates: ['candidate'] })).filter(a => a.revision_requested)
    .map(a => ({ kind: 'memory', id: a.id, label: a.topic_key, ...a.revision_requested }));
  const actions = (await store.listActions(projectId)).filter(a => a.revision_requested)
    .map(a => ({ kind: 'action', id: a.id, label: a.kind, ...a.revision_requested }));
  return [...memories, ...actions];
}

// The lines to tell the agent in this session: each open request once, and again
// if the reviewer asks anew (a new `at`).
export async function revisionNotices({ store, projectId, sessionId }) {
  if (!sessionId || !store.claimDelivery) return null;
  const lines = [];
  for (const request of await openRevisionRequests(store, projectId)) {
    if (!await store.claimDelivery(projectId, sessionId, `revision:${request.id}`, request.at)) continue;
    const reason = /[.!?]$/.test(request.reason) ? request.reason : `${request.reason}.`;
    lines.push(`DD - Revision requested for ${request.kind} ${request.id} (${request.label}): ${reason} `
      + `File a corrected version with revises=${request.id}.`);
  }
  return lines.length ? lines.join('\n') : null;
}
