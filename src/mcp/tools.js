import { proposeMemory } from '../engine/write.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { orientProject, projectContext } from '../engine/project-context.js';
import { recordOutcome } from '../engine/feedback.js';
import { declareContradiction } from '../engine/lifecycle.js';
import { checkEvidenceFreshness } from '../engine/evidence.js';

const jsonResult = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const errorResult = message => ({ isError: true, content: [{ type: 'text', text: message }] });
function proposalResult(result) {
  return { decision: result.decision, reasons: result.reasons,
    ...(result.atom ? { id: result.atom.id, lifecycle_state: result.atom.lifecycle_state,
      capture_origin: result.atom.capture_origin, capture_source: result.atom.capture_source,
      evidence_verified: result.atom.evidence_state?.verified_count ?? 0,
      ...(result.atom.replaces ? { replaces: result.atom.replaces } : {}) } : {}),
    ...(result.collides_with?.length ? { collides_with: result.collides_with.map(a => a.id) } : {}) };
}

export function createToolHandlers({ store, projectId, uiPort = 7733 }) {
  const handlers = {
    async orient(request = {}) { return orientProject(request, { store, projectId }); },
    async retrieve(request) {
      const map = await projectContext(store);
      return retrieveMemories({ ...request, project_id: projectId, facts: { ...request.facts, ...map.facts } }, { store });
    },
    async get({ id }) {
      const atom = await store.getAtom(id, projectId);
      if (atom) return { ...atom, freshness: await checkEvidenceFreshness(atom, store),
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
    async ui() { return { url: `http://127.0.0.1:${uiPort}` }; },
    async status() {
      const { counts, total } = await store.countByLifecycle(projectId);
      return { project_id: projectId, counts, total, ui_url: `http://127.0.0.1:${uiPort}` };
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
