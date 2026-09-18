import { decideAdmission } from './v2/admission.js';
import { prepareV5Write } from './v5/admission.js';
import { domainOf } from './v5/vocab.js';
import { triggerJaccard } from './health/deterioration.js';
import { normalizeProposal, sameKnowledge, validateContract } from './contract.js';
import { stampRevisionFiles, verifyReferences } from './evidence.js';

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
    const candidates = (await store.listAtoms({ projectId: payload.project_id, lifecycleStates: ['candidate'] }))
      .filter(a => a.topic_key === payload.topic_key);
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
    const atom = await store.putAtom(payload);
    const peers = await store.listAtoms({ projectId: atom.project_id, lifecycleStates: ['active', 'contested'] });
    const collides_with = peers.filter(a => a.id !== atom.id).map(peer => ({ id: peer.id, topic_key: peer.topic_key,
      jaccard: Math.round(triggerJaccard(peer.trigger, atom.trigger) * 1000) / 1000 })).filter(p => p.jaccard >= 0.5).slice(0, 20);
    await store.logAdmission({ project_id: atom.project_id, decision: 'write', reasons: ['pending_review'], atom_id: atom.id });
    return { decision: 'write', reasons: ['pending_review'], atom, collides_with };
  });
}
