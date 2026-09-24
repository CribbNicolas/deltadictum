import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { projectRelative } from '../paths.js';
import { classifyIntent, profileFor } from './v4/intent.js';
import { ftsQuery } from './v4/fts-query.js';
import { expandTopicTerms } from './v5/expander.js';
import { formsList } from './forms-util.js';
import { RECALL_STATES } from '../store/paths.js';
import { activationScore, assessApplicability, conceptTokens } from './activation.js';
import { checkEvidenceFreshness } from './evidence.js';
import { boundedBudget, estimateTokens } from './budget.js';
import { AUTHORITY_WEIGHT, NEAR_DUPLICATE, applyRedundancy, redundancyPenalty, requiredActivation, usageFactors } from './ranking.js';

const ORDER = { full: ['full', 'short', 'micro'], short: ['short', 'micro'], micro: ['micro'] };
const ACTIVATION_FLOOR = 0.35;
// Revision of a memory as delivered at session start, independent of any
// request: ambient memories are marked with it so tool calls do not repeat them.
export const AMBIENT_TAG = 'ambient';
export const ambientRevision = atom => `ambient:${revisionOf(atom)}`;
// The first sentence of the advice, for a memory that applies but whose
// authored forms no longer fit the pack. It names the rule and where to read the
// rest, so a long memory costs the pack a line instead of being dropped.
const HEADLINE_CHARS = 200;
export function headline(atom) {
  const text = String(atom.behavior_delta ?? '').replace(/\s+/g, ' ').trim();
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  const cut = first.length > HEADLINE_CHARS ? `${first.slice(0, HEADLINE_CHARS).replace(/\s+\S*$/, '')}...` : first;
  return `${cut} (get ${atom.id.slice(0, 8)} for the full advice)`;
}
const revisionOf = atom => createHash('sha256').update(JSON.stringify([atom.updated_at, atom.lifecycle_state,
  atom.evidence_state, atom.retrieval_forms, atom.assumptions, atom.revisit_when])).digest('hex').slice(0, 16);

// `semantic`, when a resident process supplies it (L2/L3), is a Map from atom id
// to an activation in [0,1] computed from embeddings. It widens the candidate
// set and competes with lexical and scope activation; every applicability gate
// still applies. Without it retrieval is purely lexical.
export async function retrieveMemories(request = {}, { store, vptThreshold, semantic } = {}) {
  if (!request.project_id) return { error: { code: 400, message: 'project_id is required' } };
  if (!String(request.action ?? '').trim()) return { error: { code: 400, message: 'action is required' } };
  request = { ...request, files: (request.files ?? []).map(file => isAbsolute(file) ? projectRelative(store.repoRoot, file) : file) };
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
    candidates = query ? await store.search({ projectId: request.project_id, query, lifecycleStates: RECALL_STATES,
      memoryTypes: request.memory_types, limit: 50 }) : [];
  } catch { candidates = []; } // Never replace a failed search with arbitrary newest memories.
  if (semantic?.size) {
    const have = new Set(candidates.map(atom => atom.id));
    for (const id of semantic.keys()) {
      if (have.has(id) || !(semantic.get(id) > 0)) continue;
      const atom = await store.getAtom(id, request.project_id);
      if (atom && RECALL_STATES.includes(atom.lifecycle_state)
          && (!request.memory_types?.length || request.memory_types.includes(atom.memory_type))) candidates.push(atom);
    }
  }

  const effective = candidates.filter(a => a.authority !== 'deprecated');
  const usage = usageFactors(effective);
  const scored = effective.map((atom, index) => {
    const applicability = assessApplicability(atom, request);
    const activation = applicability.applies
      ? Math.max(activationScore(atom, activationText, applicability.contextScore), semantic?.get(atom.id) ?? 0) : 0;
    return { atom, applicability, activation, floor: requiredActivation(atom, ACTIVATION_FLOOR),
      value: activation * Math.min(1, Math.max(0, Number(atom.confidence ?? 0.5))) * (AUTHORITY_WEIGHT[atom.authority] ?? 0.5) * usage[index] };
  }).filter(c => c.activation >= c.floor).sort((a, b) => b.value - a.value || a.atom.id.localeCompare(b.atom.id));

  const selected = [];
  // A memory that contradicts one already selected cannot join it: an injected
  // pack that argues with itself is worse than a smaller one.
  const excluded = new Set();
  const feedback = store.feedbackSummary ? await store.feedbackSummary(scored.map(c => c.atom.id), request.project_id) : {};
  // Legacy knowledge warns only where nothing current speaks: its replacement,
  // or any current memory on its topic, among those this request reached makes
  // the warning redundant. It is filtered here, never boosted.
  const current = scored.filter(c => c.atom.lifecycle_state !== 'legacy').map(c => c.atom);
  const covered = atom => current.some(a => a.id === atom.replaced_by || a.topic_key === atom.topic_key);
  for (const candidate of scored) {
    if (result.memories.length >= 8) break;
    const { atom, applicability, value } = candidate;
    if (excluded.has(atom.id)) continue;
    const legacy = atom.lifecycle_state === 'legacy';
    if (legacy && covered(atom)) continue;
    const penalty = redundancyPenalty(atom, selected.map(s => s.atom));
    if (penalty >= NEAR_DUPLICATE) continue;
    const marginal = applyRedundancy(value, penalty);
    // vpt_threshold is a floor on marginal value. It used to divide by the form's
    // tokens, which capped every memory near 50 tokens: reviewed advice longer
    // than a sentence could never be injected. Size is the budget's job.
    if (marginal < threshold) continue;
    if (request.session_id && !request.repeat && store.wasDelivered && (atom.tags ?? []).includes(AMBIENT_TAG)
        && await store.wasDelivered(request.project_id, request.session_id, atom.id, ambientRevision(atom))) continue;
    const freshness = await checkEvidenceFreshness(atom, store);
    // Changed evidence files are the ordinary state of a project under
    // development: the advice stays visible, flagged. A fact that no longer
    // holds, a due revisit or verified counterevidence withholds it instead.
    const withheldReasons = [...(applicability.revisions ?? [])];
    if (feedback[atom.id]?.refuted > 0) withheldReasons.push('reported counterevidence; review the outcome before reuse');
    const revisionReasons = [...withheldReasons, ...freshness];
    const reviewRequired = revisionReasons.length > 0;
    const withheld = withheldReasons.length > 0;
    const contested = atom.lifecycle_state === 'contested';
    const relations = contested ? await store.listRelations({ atomIds: [atom.id] }) : [];
    const relatedIds = relations.filter(r => r.relation_type === 'contradicts')
      .map(r => r.source_atom_id === atom.id ? r.target_atom_id : r.source_atom_id);
    const peers = await Promise.all(relatedIds.map(id => store.getAtom(id, request.project_id)));
    const contradicts = peers.filter(a => a && ['active', 'contested'].includes(a.lifecycle_state)).map(a => a.id);
    const state = legacy ? 'legacy' : reviewRequired ? 'review_required' : contested ? 'contested' : 'active';
    // Scope constraints are left out: which ones are restated depends on how the
    // call was shaped, not on the memory, so they would defeat session dedup.
    // Warnings (unknown assumptions) and revision reasons do change what the
    // agent should know, so a change in them delivers the memory again.
    const contextRevision = createHash('sha256').update(JSON.stringify([state, revisionReasons,
      applicability.warnings, contradicts])).digest('hex').slice(0, 16);
    const revision = revisionOf(atom) + contextRevision;
    if (request.session_id && !request.repeat && store.wasDelivered
        && await store.wasDelivered(request.project_id, request.session_id, atom.id, revision)) continue;

    const micro = formsList(atom).find(f => f.form_type === 'micro')?.content ?? atom.behavior_delta;
    const options = legacy
      ? [{ form_type: 'micro', content: `No longer done: ${micro} Abandoned because: ${String(atom.legacy_reason ?? '').replace(/\.$/, '')}. `
        + `Now: ${atom.replaced_by ?? 'no replacement recorded'}.` }]
      : withheld
      ? [{ form_type: 'micro', content: `Review ${atom.topic_key}: ${revisionReasons.join('; ')}. Fetch this memory before applying its advice.` }]
      : reviewRequired
        ? formsList(atom).filter(f => f.form_type === 'micro').map(f => ({ ...f,
          content: `EVIDENCE CHANGED since review (${freshness.slice(0, 2).join('; ')}); verify before relying on it. ${f.content}` }))
        : [...(ORDER[request.form_type ?? profile.form_type] ?? ORDER.short)
          .map(type => formsList(atom).find(f => f.form_type === type)).filter(Boolean),
          { form_type: 'headline', content: headline(atom) }];
    for (const form of options) {
      // Try a smaller form when the preferred form is too expensive OR too dilute.
      // Compact forms cannot remove the scope/assumptions that make advice valid.
      let content = form.content;
      if (contested) content = `DISPUTED; do not treat as settled. ${content}`;
      if (!withheld && applicability.constraints?.length) content += ` Only within: ${applicability.constraints.join('; ')}.`;
      if (!withheld && applicability.warnings?.length) content += ` Check: ${applicability.warnings.join('; ')}.`;
      const contentTokens = estimateTokens(content);
      // One memory may not take more than half the pack in a larger form, so a
      // long rationale falls back to micro instead of crowding out the rest.
      if (form.form_type !== 'micro' && contentTokens > budget / 2) continue;
      const hit = { id: atom.id, topic_key: atom.topic_key, memory_type: atom.memory_type,
        form_type: form.form_type, content, token_estimate: contentTokens,
        ...(state !== 'active' ? { lifecycle_state: state } : {}),
        ...(contested ? { contested: true, contradicts } : {}) };
      const trial = { ...result, memories: [...result.memories, hit], injected: true, abstained: false,
        budget: { requested: budget, used: budget } };
      if (estimateTokens(trial) > budget) continue;
      // Another hook process may have delivered it since the check above.
      if (request.session_id && !request.repeat && store.claimDelivery
          && !await store.claimDelivery(request.project_id, request.session_id, atom.id, revision)) break;
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
  // Claimed deliveries are already recorded; a repeat request refreshes the mark.
  if (request.session_id && store.markDelivered && (request.repeat || !store.claimDelivery)) for (const item of selected) {
    await store.markDelivered(request.project_id, request.session_id, item.atom.id, item.revision);
  }
  if (selected.length) await store.incrementActivation(selected.map(s => s.atom.id));
  if (request.telemetry !== false) await store.logRetrieval({ id: randomUUID(), project_id: request.project_id,
    action: request.action, query: request.query, intent, returned_atom_ids: selected.map(s => s.atom.id),
    abstained: result.abstained, budget_used: result.budget.used });
  return result;
}
