import { proposeMemory } from '../engine/write.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { orientProject, projectContext } from '../engine/project-context.js';
import { recordOutcome } from '../engine/feedback.js';
import { declareContradiction } from '../engine/lifecycle.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';
import { callRunningStore } from '../hooks/bridge.js';
import { lexicalMode, residentNotice } from '../hooks/session-start.js';

const jsonResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const errorResult = message => ({ isError: true, content: [{ type: 'text', text: message }] });
function proposalResult(result) {
  return { decision: result.decision, reasons: result.reasons,
    ...(result.atom ? { id: result.atom.id, lifecycle_state: result.atom.lifecycle_state,
      capture_origin: result.atom.capture_origin, capture_source: result.atom.capture_source,
      evidence_verified: result.atom.evidence_state?.verified_count ?? 0,
      ...(result.atom.replaces ? { replaces: result.atom.replaces } : {}),
      // Why a proposal became a revision, or why review will see it beside another
      // memory. Advisory: nothing is effective until a human approves it.
      ...(result.atom.suspected_pair?.length ? { suspected_pair: result.atom.suspected_pair } : {}) } : {}),
    ...(result.collides_with?.length ? { collides_with: result.collides_with.map(a => a.id) } : {}) };
}

// Model-facing views. The engine keeps its bookkeeping (budget, intent, forms,
// evidence hashes); the agent receives only what it can act on, once.
const HIT_FIELDS = ['id', 'memory_type', 'content', 'lifecycle_state', 'contested', 'contradicts'];
function retrieveView(result) {
  return { abstained: result.abstained, memories: result.memories.map(hit =>
    Object.fromEntries(HIT_FIELDS.filter(key => hit[key] !== undefined).map(key => [key, hit[key]]))) };
}
// retrieval_forms and what repeat behavior_delta/why; evidence_state repeats
// evidence_refs plus hashes. Only each reference's verification status is new.
const ENGINE_FIELDS = ['retrieval_forms', 'what', 'evidence_state', 'project_id', 'registry_key_id', 'schema_version', 'activation_count'];
function atomView(atom) {
  const status = new Map((atom.evidence_state?.artifacts ?? []).map(a => [`${a.source_type}\u0000${a.source_ref}`, a.status]));
  const view = Object.fromEntries(Object.entries(atom).filter(([key]) => !ENGINE_FIELDS.includes(key)));
  view.evidence_refs = (atom.evidence_refs ?? []).map(ref =>
    ({ ...ref, status: status.get(`${ref.source_type}\u0000${ref.source_ref}`) ?? 'unchecked' }));
  return view;
}

export function createToolHandlers({ store, projectId, repoRoot, uiPort = 7733, uiUrl = async () => `http://127.0.0.1:${uiPort}` }) {
  const handlers = {
    // Project facts need no embeddings; recalled memories do, so without a
    // resident (and outside lexical mode) orient answers without them.
    async orient(request = {}) {
      if (lexicalMode()) return orientProject(request, { store, projectId });
      const { action, ...rest } = request;
      const recalled = action ? await callRunningStore('retrieve', request, repoRoot ?? store.repoRoot) : null;
      const map = await orientProject(rest, { store, projectId });
      if (recalled && !recalled.error) return { ...map, memories: retrieveView(recalled).memories };
      return action ? { ...map, dd: recalled?.error?.message ?? residentNotice({ state: 'unreachable' }) } : map;
    },
    async retrieve(request) {
      // The resident process answers with semantic retrieval. Embeddings are
      // required, so without it DD is inactive (lexical only as an explicit mode).
      const bridged = await callRunningStore('retrieve', request, repoRoot ?? store.repoRoot);
      if (bridged && !bridged.error) return retrieveView(bridged);
      if (!lexicalMode()) return { error: { code: 503, message: bridged?.error?.message ?? residentNotice({ state: 'unreachable' }) } };
      const map = await projectContext(store);
      const result = await retrieveMemories({ ...request, project_id: projectId, facts: { ...request.facts, ...map.facts } }, { store });
      return result.error ? result : retrieveView(result);
    },
    async get({ id, verbose = false }) {
      const atom = await store.getAtom(id, projectId);
      if (atom) return { ...(verbose ? atom : atomView(atom)), freshness: await checkEvidenceFreshness(atom, store),
        relations: await store.listRelations({ atomIds: [atom.id] }),
        outcomes: (await store.listFeedback(projectId, atom.id)).slice(0, 10) };
      const observation = await store.getObservation(id);
      if (observation?.project_id === projectId) return { kind: 'observation', ...observation };
      throw new Error(`not_found:${id}`);
    },
    async propose({ proposals }) {
      if (!Array.isArray(proposals) || !proposals.length) throw new Error('nonempty_proposals_required');
      const results = [];
      for (const proposal of proposals) results.push(proposalResult(await proposeMemory({ ...proposal, project_id: projectId }, { store })));
      return { proposals: results };
    },
    async feedback(request) { return recordOutcome(request, { store, projectId }); },
    async list({ lifecycle_state, memory_type, capture_origin, offset = 0, limit = 20 } = {}) {
      const atoms = (await store.listAtoms({ projectId, lifecycleStates: lifecycle_state ? [lifecycle_state] : undefined,
        memoryTypes: memory_type ? [memory_type] : undefined })).filter(atom => !capture_origin || atom.capture_origin === capture_origin);
      return { total: atoms.length, memories: atoms.slice(offset, offset + Math.min(50, limit)).map(atom => ({
        id: atom.id, title: atom.title, topic_key: atom.topic_key, memory_type: atom.memory_type, lifecycle_state: atom.lifecycle_state,
        capture_origin: atom.capture_origin, capture_source: atom.capture_source })) };
    },
    async contradict({ id, contradicts }) { return declareContradiction(id, contradicts, { store, projectId }); },
    async ui() { return { url: await uiUrl() }; },
    async status() {
      const { counts, total } = await store.countByLifecycle(projectId);
      return { project_id: projectId, counts, total, ui_url: await uiUrl() };
    },
    async health() { return store.assessDeterioration(projectId); },
  };
  return Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, async args => {
    try {
      await store.refreshIfChanged();
      const result = await handler(args);
      if (result?.error) return errorResult(result.error.message);
      return jsonResult(result);
    } catch (err) { return errorResult(err.message); }
  }]));
}
