import { proposeMemory } from '../engine/write.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { decideAdmission } from '../engine/v2/admission.js';

function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function errorResult(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

export function createToolHandlers({ store, projectId, uiPort = 7733 }) {
  return {
    async supermem_retrieve({ action, query, budget_tokens }) {
      const result = await retrieveMemories({
        project_id: projectId,
        action,
        query,
        budget_tokens,
      }, { store });
      if (result.error) return errorResult(result.error.message);
      return jsonResult(result);
    },

    async supermem_get({ id }) {
      const atom = await store.getAtom(id, projectId);
      if (!atom) return errorResult(`not found: ${id}`);
      return jsonResult(atom);
    },

    async supermem_propose(payload) {
      const result = await proposeMemory({ ...payload, project_id: payload.project_id ?? projectId }, { store });
      return jsonResult(result);
    },

    async supermem_list({ lifecycle_state, memory_type } = {}) {
      const atoms = await store.listAtoms({
        projectId,
        lifecycleStates: lifecycle_state ? [lifecycle_state] : undefined,
        memoryTypes: memory_type ? [memory_type] : undefined,
      });
      return jsonResult(atoms.map(atom => ({
        id: atom.id,
        title: atom.title,
        topic_key: atom.topic_key,
        memory_type: atom.memory_type,
        lifecycle_state: atom.lifecycle_state,
        trigger: atom.trigger,
      })));
    },

    async supermem_update({ id, ...fields }) {
      const atom = await store.getAtom(id, projectId);
      if (!atom) return errorResult(`not found: ${id}`);
      const result = await proposeMemory({ ...atom, ...fields, id: atom.id, project_id: projectId }, { store });
      return jsonResult(result);
    },

    async supermem_delete({ id, confirm }) {
      const atom = await store.getAtom(id, projectId);
      if (!atom) return errorResult(`not found: ${id}`);
      if (atom.authority === 'canonical' && confirm !== true) {
        return errorResult('canonical delete requires confirm=true');
      }
      await store.deleteAtom(atom);
      return jsonResult({ deleted: true, id });
    },

    async supermem_admit({ id }) {
      const atom = await store.getAtom(id, projectId);
      if (!atom) return errorResult(`not found: ${id}`);
      const gate = decideAdmission(atom);
      if (gate.decision !== 'write' && gate.decision !== 'update') {
        return errorResult(`cannot admit (${gate.decision}): ${gate.reasons.join(', ')}`);
      }
      const stored = await store.putAtom({ ...atom, lifecycle_state: 'active' });
      return jsonResult(stored);
    },

    async supermem_reject({ id }) {
      const atom = await store.getAtom(id, projectId);
      if (!atom) return errorResult(`not found: ${id}`);
      const stored = await store.putAtom({ ...atom, lifecycle_state: 'rejected' });
      return jsonResult(stored);
    },

    async supermem_contradict({ id, contradicts }) {
      const atom = await store.getAtom(id, projectId);
      if (!atom) return errorResult(`not found: ${id}`);
      const result = await proposeMemory({ ...atom, contradicts, project_id: projectId }, { store });
      return jsonResult(result);
    },

    async supermem_resolve({ winner_id, loser_id }) {
      const winner = await store.getAtom(winner_id, projectId);
      const loser = await store.getAtom(loser_id, projectId);
      if (!winner || !loser) return errorResult('both atoms required');
      const { PREDOMINANCE_WIN_BUMP } = await import('../engine/v6/predominance.js');
      await store.putAtom({
        ...winner,
        lifecycle_state: 'active',
        contested_at: null,
        predominance: Number(winner.predominance ?? 0) + PREDOMINANCE_WIN_BUMP,
      });
      await store.putAtom({ ...loser, lifecycle_state: 'superseded', superseded_by: winner.id, contested_at: null });
      if (typeof store.logContradiction === 'function') {
        await store.logContradiction({
          project_id: projectId,
          atom_a_id: winner.id,
          atom_b_id: loser.id,
          detection_source: 'explicit',
          action: 'resolved',
          winner_atom_id: winner.id,
          reasons: ['level3_resolve'],
        });
      }
      return jsonResult({ winner_id, loser_id });
    },

    async supermem_ui() {
      return jsonResult({ url: `http://127.0.0.1:${uiPort}` });
    },

    async supermem_status() {
      const { counts, total } = await store.countByLifecycle(projectId);
      return jsonResult({
        project_id: projectId,
        counts,
        total,
        ui_url: `http://127.0.0.1:${uiPort}`,
      });
    },

    async supermem_health() {
      const report = await store.assessDeterioration(projectId);
      return jsonResult(report);
    },
  };
}
