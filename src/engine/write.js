import { randomUUID } from 'node:crypto';
import { sanitizeText } from './v2/sanitizer.js';
import { decideAdmission } from './v2/admission.js';
import { decideV3Admission } from './v3/admission.js';
import { prepareV5Write } from './v5/admission.js';
import { decideSupersession } from './v6/supersession.js';
import { PREDOMINANCE_WIN_BUMP } from './v6/predominance.js';
import { validateExplicitContradiction } from './v6/contradiction.js';
import { domainOf } from './v5/vocab.js';

const TEXT_FIELDS = ['title', 'trigger', 'behavior_delta', 'what', 'why'];

function sanitizePayload(payload) {
  const next = { ...payload };
  for (const field of TEXT_FIELDS) {
    if (next[field] != null) next[field] = sanitizeText(next[field]);
  }
  if (next.retrieval_forms && !Array.isArray(next.retrieval_forms)) {
    next.retrieval_forms = Object.fromEntries(
      Object.entries(next.retrieval_forms).map(([key, value]) => [key, sanitizeText(value)]),
    );
  }
  return next;
}

async function ensureDomainVocab(store, projectId, topicKey, tags = []) {
  const vocab = await store.getVocabulary(projectId);
  const domain = domainOf(topicKey);
  if (domain && !(vocab.domains ?? []).includes(domain)) {
    await store.createVocabularyValue(projectId, 'domain', domain);
  }
  for (const tag of tags) {
    if (tag && !(vocab.tags ?? []).includes(tag)) {
      await store.createVocabularyValue(projectId, 'tag', tag);
    }
  }
}

function applyAutoAdmit(atom, config) {
  const policy = config?.auto_admit ?? {};
  const target = policy[atom.memory_type];
  if (atom.authority === 'canonical' && (atom.memory_type === 'decision' || atom.memory_type === 'claim')) {
    return { ...atom, lifecycle_state: 'candidate' };
  }
  if (target && atom.lifecycle_state === 'active' && target !== 'active') {
    return { ...atom, lifecycle_state: target };
  }
  return atom;
}

export async function proposeMemory(rawPayload, { store }) {
  const payload = sanitizePayload({
    id: rawPayload.id ?? randomUUID(),
    schema_version: 6,
    authority: rawPayload.authority ?? 'inferred',
    confidence: rawPayload.confidence ?? 0.7,
    scope: rawPayload.scope ?? 'project',
    valid_from: rawPayload.valid_from ?? new Date().toISOString(),
    ...rawPayload,
  });

  if (!payload.project_id) {
    return { decision: 'block', reasons: ['missing_project_id'], atom: null };
  }

  await ensureDomainVocab(
    store,
    payload.project_id,
    payload.topic_key ?? 'memory/unspecified/topic',
    payload.tags ?? [],
  );

  const prepared = await prepareV5Write(payload, { repository: store });
  if (prepared.error) {
    await store.logAdmission({
      project_id: payload.project_id,
      decision: 'block',
      reasons: [prepared.error.message],
    });
    return { decision: 'block', reasons: [prepared.error.message], error: prepared.error, atom: null };
  }

  const gated = { ...payload, ...prepared.payload, registry_key_id: prepared.registry_key_id };
  if (prepared.needs_registration && gated.topic_key) {
    const entry = await store.createRegistryEntry(gated.project_id, gated.topic_key, 'provisional');
    gated.registry_key_id = entry.id;
  }

  const capsules = Array.isArray(gated.evidence_capsules) ? gated.evidence_capsules : [];
  const admission = capsules.length
    ? decideV3Admission(gated, capsules)
    : decideAdmission(gated);

  await store.logAdmission({
    project_id: gated.project_id,
    decision: admission.decision,
    reasons: admission.reasons,
    score: admission.score,
    atom_id: gated.id,
  });

  if (admission.decision === 'block' || admission.decision === 'ignore') {
    return { decision: admission.decision, reasons: admission.reasons, atom: null };
  }

  if (admission.decision === 'observe' || admission.decision === 'warn') {
    const observation = await store.putObservation({
      project_id: gated.project_id,
      source_type: gated.source_type ?? 'user_statement',
      source_ref: gated.source_ref ?? gated.id,
      raw_preview: gated.what || gated.title || gated.trigger || 'observation',
      metadata: { reasons: admission.reasons, topic_key: gated.topic_key },
    });
    return { decision: admission.decision, reasons: admission.reasons, observation, atom: null };
  }

  const live = await store.listByTopicLive(gated.project_id, gated.topic_key);
  const existing = live.find(atom => atom.id !== gated.id) ?? live.find(atom => atom.id === gated.id) ?? null;

  if (existing && existing.id !== gated.id) {
    const supersession = decideSupersession(existing, gated);
    if (supersession.action === 'update') {
      const updated = await store.putAtom({ ...existing, ...gated, id: existing.id });
      return { decision: 'update', reasons: supersession.reasons, atom: updated };
    }

    const snapshot = { ...existing };
    await store.putAtom({
      ...existing,
      lifecycle_state: 'superseded',
      superseded_by: gated.id,
    });
    try {
      const config = await store.loadConfig();
      const admitted = applyAutoAdmit({
        ...gated,
        lifecycle_state: gated.lifecycle_state ?? 'active',
        predominance: Number(gated.predominance ?? 0) + PREDOMINANCE_WIN_BUMP,
      }, config);
      const stored = await store.putAtom(admitted);
      await store.putRelation({
        source_atom_id: stored.id,
        relation_type: 'supersedes',
        target_atom_id: existing.id,
      });
      await store.logContradiction({
        project_id: gated.project_id,
        atom_a_id: existing.id,
        atom_b_id: stored.id,
        detection_source: 'same_key_supersede',
        action: 'superseded',
        winner_atom_id: stored.id,
        reasons: supersession.reasons,
      });
      return { decision: 'write', reasons: supersession.reasons, atom: stored, superseded: existing.id };
    } catch (err) {
      await store.putAtom(snapshot);
      throw err;
    }
  }

  if (gated.contradicts) {
    const other = await store.getAtom(gated.contradicts, gated.project_id);
    const check = validateExplicitContradiction(gated, other);
    if (!check.valid) {
      return { decision: 'block', reasons: [check.reason], atom: null };
    }
    const config = await store.loadConfig();
    const first = applyAutoAdmit({ ...gated, lifecycle_state: 'contested', contested_at: new Date().toISOString() }, config);
    const stored = await store.putAtom(first);
    await store.putAtom({ ...other, lifecycle_state: 'contested', contested_at: first.contested_at });
    await store.putRelation({
      source_atom_id: stored.id,
      relation_type: 'contradicts',
      target_atom_id: other.id,
    });
    await store.logContradiction({
      project_id: gated.project_id,
      atom_a_id: stored.id,
      atom_b_id: other.id,
      detection_source: 'explicit',
      action: 'contested',
      reasons: ['explicit_contradiction'],
    });
    return { decision: 'contest', reasons: ['explicit_contradiction'], atom: stored };
  }

  const config = await store.loadConfig();
  const admitted = applyAutoAdmit({
    ...gated,
    lifecycle_state: gated.lifecycle_state ?? 'active',
  }, config);
  const stored = await store.putAtom(admitted);
  return { decision: 'write', reasons: admission.reasons, atom: stored };
}
