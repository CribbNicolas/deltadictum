import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { projectRelative } from '../paths.js';
import { classifyIntent, profileFor } from './v4/intent.js';
import { ftsQuery } from './v4/fts-query.js';
import { expandTopicTerms } from './v5/expander.js';
import { formsList } from './forms-util.js';
import { RECALL_STATES } from '../store/paths.js';
import { activationScore, assessApplicability, conceptTokens, matchesGlob } from './activation.js';
import { checkEvidenceFreshness } from './evidence.js';
import { isAnchored, matchAnchors } from './anchors.js';
import { substantive } from './language.js';
import { boundedBudget, estimateTokens } from './budget.js';
import { AUTHORITY_WEIGHT, NEAR_DUPLICATE, applyRedundancy, redundancyPenalty, requiredActivation, usageFactors } from './ranking.js';

const ORDER = { full: ['full', 'short', 'micro'], short: ['short', 'micro'], micro: ['micro'] };
const ACTIVATION_FLOOR = 0.35;
const AGREE_WINDOW = 3;
const TOP_AGREE_WINDOW = 5;
// A pack's cost as the agent reads it: each memory with its widest flag and id,
// each pointer line, and a fixed envelope.
const PACK_ENVELOPE = 40;
const packCost = (memories, pointers = []) => PACK_ENVELOPE + estimateTokens([
  ...memories.map(m => `[REVIEW REQUIRED ${m.id}] ${m.content}`), ...pointers.map(p => p.line)].join('\n'));
const POINTER_WINDOW = 20;
const MAX_POINTERS = 8;
const EXPLICIT_TOP = 5;
const POINTER_REVISION = 'pointer';
// Revision of a memory as delivered at session start, independent of any
// request: ambient memories are marked with it so tool calls do not repeat them.
export const AMBIENT_TAG = 'ambient';
export const ambientRevision = atom => `ambient:${revisionOf(atom)}`;
// The first sentence of the advice, for a memory that applies but whose
// authored forms no longer fit the pack. It names the rule and where to read the
// rest, so a long memory costs the pack a line instead of being dropped.
const HEADLINE_CHARS = 200;
// When a memory applies, in one line: its trigger, trimmed. The memory map and
// pointers use it as a skill's description is used, to decide whether to pull.
export function whenLine(atom, chars = 100) {
  const text = String(atom.trigger || atom.title || '').replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  return text.length > chars ? `${text.slice(0, chars).replace(/\s+\S*$/, '')}...` : text;
}
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
export async function retrieveMemories(request = {}, { store, vptThreshold, semantic, semanticRank } = {}) {
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
  // Full-text positions (search returns best BM25 first): one of the two ranked
  // lists fused below, the dense one being semanticRank.
  const lexicalRank = new Map(candidates.map((atom, i) => [atom.id, i + 1]));
  // A prompt's agreement window: on the golden sets' tuning halves (2026-09-28), 3 gained
  // supermem an event with every must memory for one noisy negative; on tool calls
  // the same gate cost six negatives, so it is for prompts only.
  const AGREE = request.source === 'prompt' ? AGREE_WINDOW : 0;
  const agreeIds = AGREE && semanticRank ? [...semanticRank].filter(([, r]) => r <= AGREE).map(([id]) => id) : [];
  if (semantic?.size || agreeIds.length) {
    const have = new Set(candidates.map(atom => atom.id));
    for (const id of new Set([...(semantic?.keys() ?? []), ...agreeIds])) {
      if (have.has(id) || !(semantic?.get(id) > 0 || agreeIds.includes(id))) continue;
      const atom = await store.getAtom(id, request.project_id);
      if (atom && RECALL_STATES.includes(atom.lifecycle_state)
          && (!request.memory_types?.length || request.memory_types.includes(atom.memory_type))) candidates.push(atom);
    }
  }

  // An anchored memory is a candidate by its keywords alone: full-text search
  // matches exact tokens and keeps 50, and neither may decide whether it is found.
  // Recall comes first: missing an essential memory costs more than an extra one,
  // so anchors guarantee delivery and similarity may still add. A project that
  // sets anchors.only trades that recall for determinism: only anchors push.
  let anchorsOnly = false;
  {
    const have = new Set(candidates.map(atom => atom.id));
    const anchored = store.listAnchored ? await store.listAnchored({ projectId: request.project_id, lifecycleStates: RECALL_STATES })
      : await store.listAtoms({ projectId: request.project_id, lifecycleStates: RECALL_STATES });
    // A prompt with almost no content ("si dale", "seguimos con el plan") gives
    // similarity nothing to go on: only an anchor it names pushes a memory.
    anchorsOnly = config.anchors?.only === true || (request.source === 'prompt' && !substantive(request.action, 2));
    for (const atom of anchored) {
      if (have.has(atom.id) || !isAnchored(atom)) continue;
      if (request.memory_types?.length && !request.memory_types.includes(atom.memory_type)) continue;
      if (matchAnchors(atom, activationText).hits.length) candidates.push(atom);
    }
  }

  const effective = candidates.filter(a => a.authority !== 'deprecated');
  const usage = usageFactors(effective);
  const ranked = effective.map((atom, index) => {
    const anchor = matchAnchors(atom, activationText, request.files ?? []);
    const applicability = anchor.blocked.length ? { applies: false } : assessApplicability(atom, request);
    // An anchor hit (a keyword, one of its anchor files, or one of its components)
    // delivers it at full activation. Otherwise it keeps the lexical and semantic
    // activation every memory has, unless the project is strict (anchors.only).
    const scopeHit = anchor.files.length > 0
      || (atom.applies_to?.components ?? []).some(c => (request.components ?? []).some(x => x.toLowerCase() === c.toLowerCase()));
    const anchorHit = isAnchored(atom) && (anchor.hits.length > 0 || scopeHit);
    const floor = requiredActivation(atom, ACTIVATION_FLOOR);
    const lex = lexicalRank.get(atom.id) ?? Infinity;
    const dense = semanticRank?.get(atom.id) ?? Infinity;
    let activation = !applicability.applies ? 0
      : anchorHit ? 1
      : anchorsOnly ? 0
      : Math.max(activationScore(atom, activationText, applicability.contextScore), semantic?.get(atom.id) ?? 0);
    // Agreement: two independent rankings (full text and meaning) both placing a
    // memory near the top is evidence neither gives alone.
    if (AGREE && applicability.applies && !anchorsOnly && activation < floor && lex <= AGREE && dense <= AGREE) activation = floor;
    const rrf = (Number.isFinite(lex) ? 1 / (60 + lex) : 0) + (Number.isFinite(dense) ? 1 / (60 + dense) : 0) + (anchorHit ? 1 / 60 : 0);
    const reason = anchorHit ? (anchor.hits.length ? `[anchor: ${anchor.hits.join(', ')}]` : anchor.files.length ? `[anchor: ${anchor.files.join(', ')}]` : '[anchor: component]') : null;
    const weight = Math.min(1, Math.max(0, Number(atom.confidence ?? 0.5))) * (AUTHORITY_WEIGHT[atom.authority] ?? 0.5) * usage[index];
    return { atom, applicability, activation, reason, rrf, lex, dense, similarity: semantic?.get(atom.id) ?? 0, floor,
      weight, value: activation * weight };
  // Order by reciprocal rank fusion of the full-text and dense rankings (and anchor
  // hits): robust without tuning, and on the tuning halves it raised Patriark's
  // must-recall 0.91 -> 0.94 at no cost in noise. Value breaks ties.
  });
  // The fused leader of a prompt clears its floor when both rankings place it
  // within TOP_AGREE_WINDOW: a wider agreement window, for one memory only. On the
  // golden sets (2026-09-28) cutting by fused rank instead of by floor could not
  // abstain (supermem kept 2/25 tuning negatives quiet). This narrow form gained
  // one event with every must memory in supermem's tuning half and one in
  // Patriark's measuring half, for one noisy negative in supermem's measuring half.
  if (AGREE && !anchorsOnly) {
    const leader = ranked.filter(c => c.applicability.applies)
      .sort((a, b) => b.rrf - a.rrf || b.value - a.value || a.atom.id.localeCompare(b.atom.id))[0];
    if (leader && leader.activation < leader.floor && leader.lex <= TOP_AGREE_WINDOW && leader.dense <= TOP_AGREE_WINDOW) {
      leader.activation = leader.floor;
      leader.value = leader.floor * leader.weight;
    }
  }
  // An explicit retrieve (the agent called the tool) is a pull: the agent reads
  // what comes back and keeps what applies, so there is no negative to keep quiet
  // and the fused top EXPLICIT_TOP clear their floors (the rest arrive as its
  // pointers). With the English-retrieve nudge (src/hooks/session-start.js),
  // bench:pull (2026-09-29, measuring halves, no memory map, two runs) went from
  // 0.83 with pointers alone to 0.94-0.96 must-recall in supermem, whose requests
  // are Spanish and memories English; Patriark stayed at 0.90-0.92. Top 8 recalled
  // no more than top 5.
  if (request.explicit && !anchorsOnly) {
    const top = ranked.filter(c => c.applicability.applies)
      .sort((a, b) => b.rrf - a.rrf || a.atom.id.localeCompare(b.atom.id)).slice(0, EXPLICIT_TOP);
    for (const c of top) if (c.activation < c.floor) { c.activation = c.floor; c.value = c.floor * c.weight; }
  }
  const scored = ranked.filter(c => c.activation >= c.floor)
    .sort((a, b) => b.rrf - a.rrf || b.value - a.value || a.atom.id.localeCompare(b.atom.id));

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
  // The budget is spent on what the agent reads: each memory as a hook renders it
  // (its widest flag, id and content), plus a fixed envelope. Counting the result's
  // JSON keys instead cost each memory ~50 tokens the agent never sees; on the
  // golden sets' tuning halves (2026-09-28) the change gained an event with every
  // must memory in each project, at no cost in quiet negatives.
  const fits = memories => packCost(memories) <= budget;
  for (const candidate of scored) {
    if (result.memories.length >= 8) break;
    const { atom, applicability, value, reason } = candidate;
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
    // Every kind keeps a headline form last, with the same flag, so a long memory
    // can always shrink to make room for the others (recall first).
    const abandoned = what => `No longer done: ${what} Abandoned because: ${String(atom.legacy_reason ?? '').replace(/\.$/, '')}. `
      + `Now: ${atom.replaced_by ?? 'no replacement recorded'}.`;
    // Which evidence changed is in get; listing it here cost each flagged memory
    // about 50 tokens of paths.
    const changed = what => `EVIDENCE CHANGED since review; verify before relying on it. ${what}`;
    const options = legacy
      ? [{ form_type: 'micro', content: abandoned(micro) }, { form_type: 'headline', content: abandoned(headline(atom)) }]
      : withheld
      ? [{ form_type: 'micro', content: `Review ${atom.topic_key}: ${revisionReasons.join('; ')}. Fetch this memory before applying its advice.` }]
      : reviewRequired
        ? [...formsList(atom).filter(f => f.form_type === 'micro').map(f => ({ ...f, content: changed(f.content) })),
          { form_type: 'headline', content: changed(headline(atom)) }]
        : [...(ORDER[request.form_type ?? profile.form_type] ?? ORDER.short)
          .map(type => formsList(atom).find(f => f.form_type === type)).filter(Boolean),
          { form_type: 'headline', content: headline(atom) }];
    // Every form this memory can take, fullest first. Compact forms cannot remove
    // the scope/assumptions that make advice valid.
    const hits = options.map(form => {
      let content = form.content;
      if (contested) content = `DISPUTED; do not treat as settled. ${content}`;
      // Says which anchor pushed it, so the person and the agent can see why.
      if (reason) content = `${reason} ${content}`;
      if (!withheld && applicability.constraints?.length) content += ` Only within: ${applicability.constraints.join('; ')}.`;
      if (!withheld && applicability.warnings?.length) content += ` Check: ${applicability.warnings.join('; ')}.`;
      return { id: atom.id, topic_key: atom.topic_key, memory_type: atom.memory_type,
        form_type: form.form_type, content, token_estimate: estimateTokens(content),
        ...(state !== 'active' ? { lifecycle_state: state } : {}),
        ...(contested ? { contested: true, contradicts } : {}) };
    });
    // Recall first: a matching memory joins in its most compact form that fits,
    // so a long one never crowds out the rest. Room left is spent below.
    const hit = [...hits].reverse().find(h => fits([...result.memories, h]));
    if (!hit) continue;
    // Another hook process may have delivered it since the check above.
    if (request.session_id && !request.repeat && store.claimDelivery
        && !await store.claimDelivery(request.project_id, request.session_id, atom.id, revision)) continue;
    result.memories.push(hit);
    selected.push({ atom, revision, hits });
    for (const id of contradicts) excluded.add(id);
  }
  // Then, in order of value, each memory takes its fullest form the room allows.
  selected.forEach(({ hits }, i) => {
    for (const fuller of hits) {
      if (fuller.form_type === result.memories[i].form_type) break;
      const trial = result.memories.map((m, j) => j === i ? fuller : m);
      if (fits(trial)) { result.memories[i] = fuller; break; }
    }
  });
  // Near misses arrive as one-line pointers the agent can pull with get, as skill
  // descriptions do: the agent reranks them far better than any threshold. On
  // bench:pull (2026-09-29, measuring halves, no memory map), every must memory a
  // pointer showed was pulled, and 8 pointers from each list's top 20 on prompts
  // and tool calls raised must-recall 0.66 -> 0.83 (supermem) and 0.85 -> 0.92
  // (Patriark) for under one memory pulled per event outside the labels. 12 from
  // 30 added nothing. Once per session each, so a session's pointer lines are
  // bounded by the store, however many tool calls it makes.
  result.pointers = [];
  if (!anchorsOnly) {
    const delivered = new Set(result.memories.map(m => m.id));
    const near = ranked.filter(c => !delivered.has(c.atom.id) && !excluded.has(c.atom.id) && c.applicability.applies
      && ['active', 'contested'].includes(c.atom.lifecycle_state) && (c.lex <= POINTER_WINDOW || c.dense <= POINTER_WINDOW))
      .sort((a, b) => b.rrf - a.rrf || a.atom.id.localeCompare(b.atom.id));
    for (const { atom } of near) {
      if (result.pointers.length >= MAX_POINTERS) break;
      // Never for a memory this session already has in any form: a pointer to it
      // is noise, and its mark would overwrite the delivery row and let the
      // memory be claimed again.
      if (request.session_id && !request.repeat && store.deliveredInSession
          && await store.deliveredInSession(request.project_id, request.session_id, atom.id)) continue;
      result.pointers.push({ id: atom.id, topic_key: atom.topic_key, line: `${atom.topic_key} — ${whenLine(atom)} (get ${atom.id.slice(0, 8)})` });
      if (request.session_id && !request.repeat && store.markDelivered) await store.markDelivered(request.project_id, request.session_id, atom.id, POINTER_REVISION);
    }
  }
  result.injected = result.memories.length > 0;
  result.abstained = !result.injected;
  // What was delivered, pointers included. They take no share of the budget: a
  // pointer is one line, and there are at most MAX_POINTERS.
  result.budget.used = packCost(result.memories, result.pointers);
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
