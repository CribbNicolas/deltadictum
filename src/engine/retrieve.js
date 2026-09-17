import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';
import { classifyIntent, profileFor } from './v4/intent.js';
import { ftsQuery } from './v4/fts-query.js';
import { expandTopicTerms } from './v5/expander.js';
import { formsList } from './forms-util.js';
import { activationScore, assessApplicability, conceptTokens } from './activation.js';
import { checkEvidenceFreshness } from './evidence.js';
import { boundedBudget, estimateTokens } from './budget.js';
import { AUTHORITY_WEIGHT, NEAR_DUPLICATE, applyRedundancy, redundancyPenalty, requiredActivation, usageFactors } from './ranking.js';

const ORDER = { full: ['full', 'short', 'micro'], short: ['short', 'micro'], micro: ['micro'] };
const ACTIVATION_FLOOR = 0.35;
const revisionOf = atom => createHash('sha256').update(JSON.stringify([atom.updated_at, atom.lifecycle_state,
  atom.evidence_state, atom.retrieval_forms, atom.assumptions, atom.revisit_when])).digest('hex').slice(0, 16);

export async function retrieveMemories(request = {}, { store, vptThreshold } = {}) {
  if (!request.project_id) return { error: { code: 400, message: 'project_id is required' } };
  if (!String(request.action ?? '').trim()) return { error: { code: 400, message: 'action is required' } };
  request = { ...request, files: (request.files ?? []).map(file => isAbsolute(file) ? relative(store.repoRoot, file).replaceAll('\\', '/') : file) };
  const config = await store.loadConfig();
  let budget;
  try { budget = boundedBudget(request.budget_tokens, config.budget_tokens ?? 600); }
  catch (err) { return { error: { code: 400, message: err.message } }; }
  const requestedThreshold = Number(vptThreshold ?? process.env.MEMORY_V4_VPT_THRESHOLD ?? config.vpt_threshold ?? 0.02);
  const threshold = Number.isFinite(requestedThreshold) && requestedThreshold >= 0 && requestedThreshold <= 1 ? requestedThreshold : 0.02;
  const intent = classifyIntent(request);
  const profile = profileFor(intent);
  const result = { error: null, intent, memories: [], injected: false, abstained: true,
    budget: { requested: budget, used: 0 } };
  const activationText = [request.action, request.query, ...(request.files ?? []), ...(request.components ?? []), request.operation].filter(Boolean).join(' ').slice(0, 4000);
  const expansion = await expandTopicTerms(request.project_id, activationText, { repository: store }).catch(() => null);
  const query = ftsQuery(`${activationText} ${conceptTokens(activationText).join(' ')} ${(expansion?.terms ?? []).join(' ')}`);
  let candidates;
  try {
    candidates = query ? await store.search({ projectId: request.project_id, query, lifecycleStates: ['active', 'contested'],
      memoryTypes: request.memory_types, limit: 50 }) : [];
  } catch { candidates = []; } // Never replace a failed search with arbitrary newest memories.

  const effective = candidates.filter(a => a.authority !== 'deprecated');
  const usage = usageFactors(effective);
  const scored = effective.map((atom, index) => {
    const applicability = assessApplicability(atom, request);
    const activation = applicability.applies ? activationScore(atom, activationText, applicability.contextScore) : 0;
    return { atom, applicability, activation, floor: requiredActivation(atom, ACTIVATION_FLOOR),
      value: activation * Math.min(1, Math.max(0, Number(atom.confidence ?? 0.5))) * (AUTHORITY_WEIGHT[atom.authority] ?? 0.5) * usage[index] };
  }).filter(c => c.activation >= c.floor).sort((a, b) => b.value - a.value || a.atom.id.localeCompare(b.atom.id));

  const selected = [];
  // A memory that contradicts one already selected cannot join it: an injected
  // pack that argues with itself is worse than a smaller one.
  const excluded = new Set();
  const feedback = store.feedbackSummary ? await store.feedbackSummary(scored.map(c => c.atom.id), request.project_id) : {};
  for (const candidate of scored) {
    if (result.memories.length >= 8) break;
    const { atom, applicability, value } = candidate;
    if (excluded.has(atom.id)) continue;
    const penalty = redundancyPenalty(atom, selected.map(s => s.atom));
    if (penalty >= NEAR_DUPLICATE) continue;
    const marginal = applyRedundancy(value, penalty);
    const freshness = await checkEvidenceFreshness(atom, store);
    const revisionReasons = [...(applicability.revisions ?? []), ...freshness];
    if (feedback[atom.id]?.refuted > 0) revisionReasons.push('reported counterevidence; review the outcome before reuse');
    const reviewRequired = revisionReasons.length > 0;
    const contested = atom.lifecycle_state === 'contested';
    const relations = contested ? await store.listRelations({ atomIds: [atom.id] }) : [];
    const relatedIds = relations.filter(r => r.relation_type === 'contradicts')
      .map(r => r.source_atom_id === atom.id ? r.target_atom_id : r.source_atom_id);
    const peers = await Promise.all(relatedIds.map(id => store.getAtom(id, request.project_id)));
    const contradicts = peers.filter(a => a && ['active', 'contested'].includes(a.lifecycle_state)).map(a => a.id);
    const state = reviewRequired ? 'review_required' : contested ? 'contested' : 'active';
    const contextRevision = createHash('sha256').update(JSON.stringify([state, revisionReasons,
      applicability.constraints, applicability.warnings, contradicts])).digest('hex').slice(0, 16);
    const revision = revisionOf(atom) + contextRevision;
    if (request.session_id && !request.repeat && store.wasDelivered
        && await store.wasDelivered(request.project_id, request.session_id, atom.id, revision)) continue;

    const options = reviewRequired
      ? [{ form_type: 'micro', content: `Review ${atom.topic_key}: ${revisionReasons.join('; ')}. Fetch this memory before applying its advice.` }]
      : (ORDER[request.form_type ?? profile.form_type] ?? ORDER.short)
        .map(type => formsList(atom).find(f => f.form_type === type)).filter(Boolean);
    for (const form of options) {
      // Try a smaller form when the preferred form is too expensive OR too dilute.
      // Compact forms cannot remove the scope/assumptions that make advice valid.
      let content = form.content;
      if (contested) content = `DISPUTED; do not treat as settled. ${content}`;
      if (!reviewRequired && applicability.constraints?.length) content += ` Only within: ${applicability.constraints.join('; ')}.`;
      if (!reviewRequired && applicability.warnings?.length) content += ` Check: ${applicability.warnings.join('; ')}.`;
      const contentTokens = estimateTokens(content);
      if (!reviewRequired && marginal / Math.max(1, estimateTokens(form.content)) < threshold) continue;
      const hit = { id: atom.id, topic_key: atom.topic_key, memory_type: atom.memory_type,
        form_type: form.form_type, content, token_estimate: contentTokens,
        ...(state !== 'active' ? { lifecycle_state: state } : {}),
        ...(contested ? { contested: true, contradicts } : {}) };
      const trial = { ...result, memories: [...result.memories, hit], injected: true, abstained: false,
        budget: { requested: budget, used: budget } };
      if (estimateTokens(trial) > budget) continue;
      result.memories.push(hit);
      selected.push({ atom, revision });
      for (const id of contradicts) excluded.add(id);
      break;
    }
  }
  result.injected = result.memories.length > 0;
  result.abstained = !result.injected;
  // The empty envelope is a fixed protocol cost, including when the caller asks
  // for less than that cost. No memory content is emitted in that case.
  result.budget.used = estimateTokens({ ...result, budget: { requested: budget, used: budget } });
  if (request.session_id && store.markDelivered) for (const item of selected) {
    await store.markDelivered(request.project_id, request.session_id, item.atom.id, item.revision);
  }
  if (selected.length) await store.incrementActivation(selected.map(s => s.atom.id));
  if (request.telemetry !== false) await store.logRetrieval({ id: randomUUID(), project_id: request.project_id,
    action: request.action, query: request.query, intent, returned_atom_ids: selected.map(s => s.atom.id),
    abstained: result.abstained, budget_used: result.budget.used });
  return result;
}
