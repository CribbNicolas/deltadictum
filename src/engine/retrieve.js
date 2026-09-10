import { classifyIntent, profileFor } from './v4/intent.js';
import { triggerActivationScore } from './v4/trigger-match.js';
import { ftsQuery } from './v4/fts-query.js';
import { selectForm } from './v4/forms.js';
import { expandTopicTerms } from './v5/expander.js';
import { formsList } from './forms-util.js';

const AUTHORITY_WEIGHT = {
  canonical: 1.0,
  validated: 0.85,
  inferred: 0.6,
  observed: 0.5,
  deprecated: 0,
};

const DEFAULT_BUDGET_TOKENS = 600;
const DEFAULT_VPT_THRESHOLD = 0.02;
const MAX_INJECTED = 8;
const CANDIDATE_LIMIT = 50;

function numericOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveVptThreshold(store, vptThreshold) {
  const explicit = numericOrNull(vptThreshold);
  if (explicit != null) return explicit;
  const env = numericOrNull(process.env.MEMORY_V4_VPT_THRESHOLD);
  if (env != null) return env;
  if (typeof store.loadConfig === 'function') {
    try {
      const fromConfig = numericOrNull((await store.loadConfig())?.vpt_threshold);
      if (fromConfig != null) return fromConfig;
    } catch {
      // missing or unreadable config falls through to the engine default
    }
  }
  return DEFAULT_VPT_THRESHOLD;
}

function emptyResult(intent, requested) {
  return {
    error: null,
    intent,
    memories: [],
    injected: false,
    abstained: true,
    budget: { requested, used: 0 },
  };
}

function isExpired(atom, now) {
  return atom.valid_until && Date.parse(atom.valid_until) <= now;
}

function compactHit(candidate, form, value_per_token) {
  return {
    id: candidate.id,
    topic_key: candidate.topic_key,
    memory_type: candidate.memory_type,
    title: candidate.title,
    trigger: candidate.trigger,
    lifecycle_state: candidate.lifecycle_state,
    form_type: form.form_type,
    content: form.content,
    token_estimate: form.token_estimate,
    activation_score: candidate.activation_score,
    contested: candidate.lifecycle_state === 'contested',
    value_per_token,
  };
}

async function loadCandidates(store, request, lifecycle, memoryTypes, activationText) {
  const query = ftsQuery(activationText);
  if (query && typeof store.search === 'function') {
    try {
      return await store.search({
        projectId: request.project_id,
        query,
        lifecycleStates: lifecycle,
        memoryTypes,
        limit: CANDIDATE_LIMIT,
      });
    } catch {
      // invalid MATCH or missing FTS — fall through to filtered list
    }
  }
  const listed = await store.listAtoms({
    projectId: request.project_id,
    lifecycleStates: lifecycle,
    memoryTypes,
  });
  return listed.slice(0, CANDIDATE_LIMIT);
}

export async function retrieveMemories(request = {}, { store, vptThreshold } = {}) {
  if (!request.project_id) return { error: { code: 400, message: 'project_id is required' } };
  if (!request.action || !String(request.action).trim()) {
    return { error: { code: 400, message: 'action is required' } };
  }
  if (request.budget_tokens != null && (!Number.isFinite(Number(request.budget_tokens)) || Number(request.budget_tokens) <= 0)) {
    return { error: { code: 400, message: 'budget_tokens must be a positive number' } };
  }

  const requestedBudget = request.budget_tokens != null ? Number(request.budget_tokens) : DEFAULT_BUDGET_TOKENS;
  const threshold = await resolveVptThreshold(store, vptThreshold);
  const intent = classifyIntent(request);
  const profile = profileFor(intent);
  const now = Date.now();

  let expansion = null;
  try {
    expansion = await expandTopicTerms(request.project_id, `${request.action} ${request.query ?? ''}`, { repository: store });
    if (expansion && (expansion.terms?.length ?? 0) === 0) expansion = null;
  } catch {
    expansion = null;
  }

  if (intent === 'abstain') {
    await store.logRetrieval({
      project_id: request.project_id,
      query: request.query,
      action: request.action,
      intent,
      returned_atom_ids: [],
      abstained: true,
      budget_used: 0,
    });
    return emptyResult(intent, requestedBudget);
  }

  const lifecycle = request.lifecycle_states ?? ['active', 'contested'];
  const memoryTypes = request.memory_types ?? profile.memory_types ?? undefined;
  const activationText = `${request.action} ${request.query ?? ''} ${(expansion?.terms ?? []).join(' ')}`;
  let candidates = await loadCandidates(store, request, lifecycle, memoryTypes, activationText);

  if (request.scopes?.length) {
    candidates = candidates.filter(atom => request.scopes.includes(atom.scope));
  }

  candidates = candidates.filter(atom => atom.authority !== 'deprecated' && !isExpired(atom, now));

  const scored = candidates.map(memory => {
    const activation_score = triggerActivationScore(activationText, memory.trigger);
    const authorityWeight = AUTHORITY_WEIGHT[memory.authority] ?? 0.5;
    return {
      ...memory,
      activation_score,
      value_score: activation_score * Number(memory.confidence ?? 0.5) * authorityWeight,
      contested_hint: memory.lifecycle_state === 'contested',
    };
  });

  scored.sort((a, b) => {
    const aAnti = a.memory_type === 'anti_memory' && a.activation_score > 0 ? 1 : 0;
    const bAnti = b.memory_type === 'anti_memory' && b.activation_score > 0 ? 1 : 0;
    if (aAnti !== bAnti) return bAnti - aAnti;
    const aContested = a.contested_hint ? 1 : 0;
    const bContested = b.contested_hint ? 1 : 0;
    if (aContested !== bContested) return aContested - bContested;
    return b.value_score - a.value_score;
  });

  let remaining = requestedBudget;
  let bestVpt = null;
  const injected = [];

  for (const candidate of scored) {
    if (injected.length >= MAX_INJECTED) break;
    const form = selectForm(formsList(candidate), profile.form_type, remaining);
    if (!form) continue;
    const value_per_token = candidate.value_score / Math.max(1, Number(form.token_estimate));
    if (value_per_token < threshold) continue;
    remaining -= Number(form.token_estimate);
    if (bestVpt === null || value_per_token > bestVpt) bestVpt = value_per_token;
    injected.push(compactHit(candidate, form, value_per_token));
  }

  if (injected.some(memory => memory.contested)) {
    const relations = await store.listRelations({
      atomIds: injected.filter(memory => memory.contested).map(memory => memory.id),
    });
    for (const memory of injected) {
      if (!memory.contested) continue;
      memory.contradicts = relations
        .filter(rel => rel.relation_type === 'contradicts' && (rel.source_atom_id === memory.id || rel.target_atom_id === memory.id))
        .map(rel => rel.source_atom_id === memory.id ? rel.target_atom_id : rel.source_atom_id);
    }
  }

  if (injected.length > 0 && typeof store.incrementActivation === 'function') {
    await store.incrementActivation(injected.map(memory => memory.id));
  }

  await store.logRetrieval({
    project_id: request.project_id,
    query: request.query,
    action: request.action,
    intent,
    returned_atom_ids: injected.map(memory => memory.id),
    abstained: injected.length === 0,
    value_per_token: bestVpt,
    budget_used: requestedBudget - remaining,
  });

  return {
    error: null,
    intent,
    memories: injected,
    injected: injected.length > 0,
    abstained: injected.length === 0,
    budget: { requested: requestedBudget, used: requestedBudget - remaining },
  };
}
