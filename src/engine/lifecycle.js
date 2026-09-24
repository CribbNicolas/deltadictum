import { decideAdmission } from './v2/admission.js';
import { healthThresholdsFromConfig, retirementCandidates } from './health/deterioration.js';
import { stampRevisionFiles, verifyReferences } from './evidence.js';
import { cappedConfidence } from './reliability.js';
import { validateExplicitContradiction } from './v6/contradiction.js';
import { bumpPredominance } from './v6/predominance.js';

// Only the local review transport constructs this capability. It is never an MCP argument.
export const HUMAN_REVIEW = Symbol('local-human-review');
function requireReview(actor) { if (actor !== HUMAN_REVIEW) throw new Error('human_review_required'); }

async function effectivePeers(id, store, projectId) {
  const relations = await store.listRelations({ atomIds: [id] });
  const ids = relations.filter(r => r.relation_type === 'contradicts')
    .map(r => r.source_atom_id === id ? r.target_atom_id : r.source_atom_id);
  return (await Promise.all(ids.map(peerId => store.getAtom(peerId, projectId))))
    .filter(a => a && ['active', 'contested'].includes(a.lifecycle_state));
}

export async function admitMemory(id, { store, projectId, actor, rationale, authority } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const candidate = await store.getAtom(id, projectId);
    if (!candidate || candidate.lifecycle_state !== 'candidate') throw new Error('candidate_required');
    // A reviewer asked for changes: only the corrected version can be admitted.
    if (candidate.revision_requested) throw new Error('revision_requested');
    if (!rationale?.trim()) throw new Error('review_rationale_required');
    const gate = decideAdmission(candidate);
    if (gate.decision !== 'write') throw new Error(`cannot_admit:${gate.reasons.join(',')}`);
    const evidence_state = await verifyReferences(candidate.evidence_refs, { store, projectId });
    if (evidence_state.artifacts.some(a => a.status === 'out_of_scope')) throw new Error('evidence_scope_violation');
    const live = (await store.listByTopicLive(projectId, candidate.topic_key))[0];
    // A candidate proposed while nothing on its topic_key was live yet never had
    // a target to name -- `replaces` is unset, not stale. Only reject when it
    // names a target that has since stopped being the live one: that is the
    // actual "reviewed against an understanding that is no longer current" case
    // this guards against.
    if (live && candidate.replaces && candidate.replaces !== live.id) throw new Error('replacement_changed_review_again');
    // A trigger-collision `update` names a replacement on another topic_key, so the
    // target cannot be found by topic. It is resolved by id and must still be
    // effective: if it was superseded or retired since the proposal, the revision
    // no longer describes the store the reviewer is looking at.
    const target = candidate.replaces ? await store.getAtom(candidate.replaces, projectId) : null;
    if (candidate.replaces && !['active', 'contested'].includes(target?.lifecycle_state)) {
      throw new Error('replacement_changed_review_again');
    }
    const current = live ?? target;
    const now = new Date().toISOString();
    const granted = authority === 'canonical' || candidate.requested_authority === 'canonical' ? 'canonical' : 'validated';
    // The cap applies here rather than only at proposal: candidates are never
    // retrieved, so a proposal-time confidence affects no ranking. This is the
    // number the retrieval value formula reads, and it is derived from the
    // freshly verified evidence rather than from what the candidate carried.
    const confidence = cappedConfidence({ ...candidate, evidence_state }, { authority: granted });
    const approved = await stampRevisionFiles({ ...candidate, lifecycle_state: 'active',
      authority: granted, confidence,
      evidence_state: { ...evidence_state, support: 'human_reviewed' },
      review: { source: 'local_ui', reviewed_at: now, rationale: rationale.trim() },
    }, store);
    const peers = current ? await effectivePeers(current.id, store, projectId) : [];
    if (peers.length) { approved.lifecycle_state = 'contested'; approved.contested_at = now; }
    const atoms = current ? [{ ...current, lifecycle_state: 'superseded', superseded_by: approved.id }, approved] : [approved];
    const relations = current ? [{ source_atom_id: approved.id, relation_type: 'supersedes', target_atom_id: current.id }] : [];
    for (const peer of peers) relations.push({ source_atom_id: approved.id, relation_type: 'contradicts', target_atom_id: peer.id });
    const stored = await store.commitAtoms(atoms, relations);
    await store.logAdmission({ project_id: projectId, decision: 'admit', reasons: ['human_reviewed'], atom_id: id });
    return stored.find(a => a.id === id);
  });
}

export async function rejectMemory(id, { store, projectId, actor } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const atom = await store.getAtom(id, projectId);
    if (!atom || atom.lifecycle_state !== 'candidate') throw new Error('candidate_required');
    return store.putAtom({ ...atom, lifecycle_state: 'rejected' });
  });
}

export async function declareContradiction(id, contradicts, { store, projectId }) {
  return store.withWriteLock(async () => {
    const atom = await store.getAtom(id, projectId);
    const other = await store.getAtom(contradicts, projectId);
    const check = validateExplicitContradiction(atom ?? {}, other);
    if (!atom || !check.valid) throw new Error(check.reason ?? 'not_found');
    if (![atom, other].every(a => ['active', 'contested'].includes(a.lifecycle_state))) throw new Error('effective_memories_required');
    const now = new Date().toISOString();
    await store.commitAtoms([atom, other].map(a => ({ ...a, lifecycle_state: 'contested', contested_at: now })),
      [{ source_atom_id: atom.id, relation_type: 'contradicts', target_atom_id: other.id }]);
    await store.logContradiction({ project_id: projectId, atom_a_id: id, atom_b_id: contradicts,
      detection_source: 'explicit', action: 'contested', reasons: ['explicit_contradiction'] });
    return { decision: 'contest', ids: [id, contradicts] };
  });
}

export async function resolveMemories(winnerId, loserId, { store, projectId, actor, rationale } = {}) {
  requireReview(actor);
  if (!rationale?.trim()) throw new Error('review_rationale_required');
  return store.withWriteLock(async () => {
    const winner = await store.getAtom(winnerId, projectId);
    const loser = await store.getAtom(loserId, projectId);
    const relations = await store.listRelations({ atomIds: [winnerId] });
    if (!winner || !loser || winnerId === loserId || ![winner, loser].every(a => a.lifecycle_state === 'contested')
      || !relations.some(r => r.relation_type === 'contradicts' && [r.source_atom_id, r.target_atom_id].includes(loserId))) throw new Error('contested_pair_required');
    const peerIds = relations.filter(r => r.relation_type === 'contradicts')
      .map(r => r.source_atom_id === winnerId ? r.target_atom_id : r.source_atom_id).filter(id => id !== loserId);
    const peers = await Promise.all(peerIds.map(id => store.getAtom(id, projectId)));
    const stillContested = peers.some(a => a && ['active', 'contested'].includes(a.lifecycle_state));
    // A win is a track record, not evidence: predominance is the lowest tier of
    // the resolution order and can never outrank evidence, recency or authority.
    const atoms = [{ ...loser, lifecycle_state: 'superseded', superseded_by: winnerId, contested_at: null },
      { ...winner, lifecycle_state: stillContested ? 'contested' : 'active', contested_at: stillContested ? winner.contested_at : null,
        predominance: bumpPredominance(winner),
        review: { source: 'local_ui', reviewed_at: new Date().toISOString(), rationale: rationale.trim() } }];
    // Other decisions cease to be disputed only if the retired loser was their
    // last effective opposing decision. Unrelated disputes remain unresolved.
    for (const peer of await effectivePeers(loserId, store, projectId)) {
      if (peer.id === winnerId) continue;
      const remaining = (await effectivePeers(peer.id, store, projectId)).filter(a => a.id !== loserId);
      if (!remaining.length) atoms.push({ ...peer, lifecycle_state: 'active', contested_at: null });
    }
    await store.commitAtoms(atoms);
    await store.logContradiction({ project_id: projectId, atom_a_id: winnerId, atom_b_id: loserId,
      detection_source: 'explicit', action: 'resolved', winner_atom_id: winnerId, reasons: ['human_reviewed'] });
    return { winner_id: winnerId, loser_id: loserId };
  });
}

// Archiving is not deleting. The file moves to `archive/`, the memory leaves the
// retrieval surface and the effective-set uniqueness predicate, and a human can
// bring it back. Deletion stays a separate, manual, confirmed action.
//
// Authority protects: a human put `validated` or `canonical` there, so crowding
// caused by reviewed knowledge is a review decision, never an automatic one.
// Every archived memory says why, in words a reviewer reads when cleaning up.
export async function archiveMemory(id, { store, projectId, reason } = {}) {
  if (!String(reason ?? '').trim()) throw new Error('archive_reason_required');
  return store.withWriteLock(async () => {
    const atom = await store.getAtom(id, projectId);
    if (!atom || atom.lifecycle_state !== 'active') throw new Error('active_memory_required');
    if (!['inferred', 'observed'].includes(atom.authority)) throw new Error('authority_protected');
    return store.putAtom({ ...atom, lifecycle_state: 'archived',
      archived_at: new Date().toISOString(), archived_reason: String(reason).trim() });
  });
}

export async function restoreMemory(id, { store, projectId, actor } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const atom = await store.getAtom(id, projectId);
    // A legacy practice can be brought back the same way when it turns out to hold.
    if (!atom || !['archived', 'legacy'].includes(atom.lifecycle_state)) throw new Error('archived_memory_required');
    // Archiving frees the topic_key, so another memory may hold it by now.
    // Restoring cannot take it back: that would put two memories on one trigger.
    const live = (await store.listByTopicLive(projectId, atom.topic_key))[0];
    if (live && live.id !== atom.id) throw new Error('topic_key_taken');
    return store.putAtom({ ...atom, lifecycle_state: 'active', archived_at: null, archived_reason: null,
      legacy_reason: null, legacy_at: null, replaced_by: null });
  });
}

// Lazily evaluated on a path that is already running and already holds the lock
// (L2 forbids a background worker, L1 forbids the hot path). Retirement is never
// urgent; a day late costs nothing. Callers must not let it fail their write (L5).
export async function retireByDisuse({ store, projectId, now } = {}) {
  const thresholds = healthThresholdsFromConfig(await store.loadConfig());
  const snapshot = await store.loadHealthSnapshot(projectId);
  const archived = [];
  const events = snapshot.retrieval_events ?? [];
  for (const atom of retirementCandidates(snapshot, now ?? new Date().toISOString(), thresholds)) {
    const since = Date.parse(atom.created_at);
    const chances = events.filter(event => Date.parse(event.created_at) >= since).length;
    const reason = `Never activated in ${chances} retrievals since ${String(atom.created_at).slice(0, 10)}.`;
    // One memory that refuses the transition does not stop the others.
    try { archived.push((await archiveMemory(atom.id, { store, projectId, reason })).id); } catch { /* left effective */ }
  }
  return archived;
}
