import { decideAdmission, routeTriggerCollision } from './v2/admission.js';
import { prepareV5Write } from './v5/admission.js';
import { domainOf } from './v5/vocab.js';
import { triggerJaccard } from './health/deterioration.js';
import { normalizeProposal, sameKnowledge, validateContract } from './contract.js';
import { stampRevisionFiles, verifyReferences } from './evidence.js';
import { retireByDisuse } from './lifecycle.js';

export async function proposeMemory(rawPayload, { store, captureSource = 'agent' }) {
  return store.withWriteLock(async () => {
    const payload = normalizeProposal(rawPayload, rawPayload.project_id, { captureSource });
    const invalid = validateContract(payload);
    const base = decideAdmission(payload);
    const reasons = [...invalid, ...base.reasons.filter(r => r !== 'durable_contract_satisfied')];
    if (invalid.length || base.decision === 'block') {
      await store.logAdmission({ project_id: payload.project_id, decision: 'block', reasons });
      return { decision: 'block', reasons, atom: null };
    }
    if (base.decision !== 'write') {
      const observation = await store.putObservation({ project_id: payload.project_id,
        source_type: 'proposal', source_ref: payload.id, raw_preview: payload.behavior_delta || payload.title || 'Incomplete proposal',
        metadata: { reasons, provenance: captureSource === 'local_ui' ? 'local_ui' : 'agent_claim',
          capture_origin: payload.capture_origin, capture_source: payload.capture_source } });
      await store.logAdmission({ project_id: payload.project_id, decision: 'observe', reasons });
      return { decision: 'observe', reasons, observation, atom: null };
    }
    const domain = domainOf(payload.topic_key);
    const vocab = await store.getVocabulary(payload.project_id);
    if (domain && !vocab.domains.includes(domain)) await store.createVocabularyValue(payload.project_id, 'domain', domain);
    for (const tag of payload.tags) if (!vocab.tags.includes(tag)) await store.createVocabularyValue(payload.project_id, 'tag', tag);
    const prepared = await prepareV5Write(payload, { repository: store });
    if (prepared.error) {
      await store.logAdmission({ project_id: payload.project_id, decision: 'block', reasons: [prepared.error.message] });
      return { decision: 'block', reasons: [prepared.error.message], atom: null };
    }
    Object.assign(payload, prepared.payload, { registry_key_id: prepared.registry_key_id });
    if (prepared.needs_registration) payload.registry_key_id = (await store.createRegistryEntry(payload.project_id, payload.topic_key, 'provisional')).id;

    const existing = (await store.listByTopicLive(payload.project_id, payload.topic_key))[0];
    const pending = await store.listAtoms({ projectId: payload.project_id, lifecycleStates: ['candidate'] });
    const candidates = pending.filter(a => a.topic_key === payload.topic_key);
    // Model-supplied evidence hashes, approval labels and lifecycle fields are ignored.
    payload.evidence_state = await verifyReferences(payload.evidence_refs, { store, projectId: payload.project_id });
    if (payload.evidence_state.artifacts.some(a => a.status === 'out_of_scope')) {
      await store.logAdmission({ project_id: payload.project_id, decision: 'block', reasons: ['evidence_scope_violation'] });
      return { decision: 'block', reasons: ['evidence_scope_violation'], atom: null };
    }
    if (existing) payload.replaces = existing.id;
    if (rawPayload.requested_authority === 'canonical' || rawPayload.authority === 'canonical') payload.requested_authority = 'canonical';
    await stampRevisionFiles(payload, store);
    const evidenceSignature = atom => JSON.stringify([(atom.evidence_state?.artifacts ?? []).map(a => [a.source_ref, a.hash, a.status]),
      (atom.revisit_when ?? []).map(rule => rule.hash ?? null)]);
    const duplicate = [existing, ...candidates].find(a => a && sameKnowledge(a, payload) && evidenceSignature(a) === evidenceSignature(payload));
    // A repeated request does not create knowledge or rewrite its original capture attribution.
    if (duplicate) {
      // Recorded, not just returned: duplicate rate is measured from the admission log.
      await store.logAdmission({ project_id: payload.project_id, decision: 'ignore',
        reasons: ['equivalent_knowledge_exists'], atom_id: duplicate.id });
      return { decision: 'ignore', reasons: ['equivalent_knowledge_exists'], atom: duplicate };
    }
    // The collision is computed before the write, not after it: a decision cannot
    // be routed on a value produced by the write it is supposed to route.
    const { jaccard: threshold } = (await store.loadConfig()).health.trigger_collision;
    const peers = await store.listAtoms({ projectId: payload.project_id, lifecycleStates: ['active', 'contested'] });
    const collides_with = peers.filter(a => a.id !== payload.id).map(peer => ({ id: peer.id, topic_key: peer.topic_key,
      jaccard: Math.round(triggerJaccard(peer.trigger, payload.trigger) * 1000) / 1000 })).filter(p => p.jaccard >= threshold).slice(0, 20);
    // Candidates join the comparison. Repeated corrections on one topic arrive as
    // candidates, and two near-identical candidates are the pair a reviewer should
    // see together; a candidate is never a revision target, only a flag.
    let route = routeTriggerCollision(payload, [...peers, ...pending], threshold, triggerJaccard);
    if (route.decision === 'update' && existing) {
      // The proposal already revises the live memory on its own topic. One
      // candidate superseding two memories is not something review can express.
      route = { decision: 'write', reasons: ['suspected_duplicate_pair'], suspected_pair: route.suspected_pair };
    }
    // `replaces` already tells the reviewer what an update revises; flagging the
    // same pair as suspected on top of it would say the opposite of what
    // approving the candidate does. The flag belongs to the escalated case only.
    if (route.decision === 'update') payload.replaces = route.replaces;
    else if (route.suspected_pair?.length) payload.suspected_pair = route.suspected_pair;
    const decided = ['pending_review', ...route.reasons];
    const atom = await store.putAtom(payload);
    await store.logAdmission({ project_id: atom.project_id, decision: route.decision, reasons: decided, atom_id: atom.id });
    // A corrected version answers a reviewer's revision request: the revised
    // candidate closes, linked to this one, so only the correction stays pending.
    // Only a candidate a reviewer sent back closes, and only by its own id: getAtom
    // also resolves topic keys, which would name the correction itself.
    if (rawPayload.revises) {
      const revised = await store.getAtom(String(rawPayload.revises), atom.project_id);
      if (revised?.id === String(rawPayload.revises) && revised.id !== atom.id && revised.lifecycle_state === 'candidate'
          && revised.revision_requested) {
        await store.putAtom({ ...revised, lifecycle_state: 'rejected', revised_by: atom.id });
      }
    }
    // Forgetting is evaluated lazily, here, where a process is already running and
    // already holds the lock. It is advisory housekeeping: a failure to retire
    // anything must never fail the write that triggered the sweep (L5).
    try { await retireByDisuse({ store, projectId: atom.project_id }); } catch { /* nothing retired */ }
    return { decision: route.decision, reasons: decided, atom, collides_with };
  });
}
