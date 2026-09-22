import { retrieveMemories } from '../engine/retrieve.js';
import { loadEmbedder } from './embedder.js';
import { syncVectors, cosine } from './vectors.js';

// Embedding similarities from multilingual-e5 are compressed (0.75-0.90 for
// related and unrelated text alike), so the signal is how far a memory stands
// above the query's own mean similarity, not the raw value. Only the top
// `topK` memories are considered, and a margin below `floor` contributes
// nothing, which is what lets an unrelated request abstain.
//
// Chosen by a grid over the supermem benchmark (2026-09-22): must-recall holds at
// 0.83 across floor 0.015-0.04; 0.04 is the widest setting that keeps every
// unrelated task quiet. Lower floor trades silence for orbit recall.
export const DEFAULT_CALIBRATION = Object.freeze({ floor: 0.04, full: 0.07, topK: 5 });

// Tool calls arrive as `Tool {json}`; the keys and punctuation are noise to an
// embedding model, the paths and strings are the content.
export function queryText(action) {
  return String(action ?? '').replace(/"(file_path|old_string|new_string|command|pattern|path|content|input)"\s*:/g, ' ')
    .replace(/[{}"\\[\],]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

export function semanticActivation(sims, { floor, full, topK } = DEFAULT_CALIBRATION) {
  const values = [...sims.values()];
  if (!values.length) return new Map();
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const ranked = [...sims.entries()].sort((a, b) => b[1] - a[1]).slice(0, topK);
  const activation = new Map();
  for (const [id, sim] of ranked) {
    const value = Math.min(1, Math.max(0, (sim - mean - floor) / Math.max(1e-6, full - floor)));
    if (value > 0) activation.set(id, value);
  }
  return activation;
}

// `blocking: false` is for the resident process answering hooks: until the model
// has loaded, a request is answered lexically instead of waiting on it (L5).
export function createSemanticRetrieve({ embedder: given, calibration = DEFAULT_CALIBRATION, load = loadEmbedder, blocking = true } = {}) {
  let embedder = given;
  let loading;
  const start = () => (loading ??= Promise.resolve().then(load).then(ready => { embedder = ready; return ready; }, () => null));
  async function ready() {
    if (embedder !== undefined) return embedder;
    return blocking ? start() : (start(), undefined);
  }
  async function semanticRetrieve(request, deps) {
    const active = await ready();
    if (!active) return retrieveMemories(request, deps);
    const vectors = await syncVectors({ store: deps.store, projectId: request.project_id, embedder: active });
    const [query] = await active.embed([queryText(request.action)], 'query');
    const sims = new Map([...vectors].map(([id, vector]) => [id, cosine(query, vector)]));
    return retrieveMemories(request, { ...deps, semantic: semanticActivation(sims, calibration) });
  }
  // Load the model and embed the store ahead of the first hook, so the first
  // bridged call does not pay for either.
  semanticRetrieve.warm = async ({ store, projectId }) => {
    const active = await start();
    if (active) await syncVectors({ store, projectId, embedder: active });
    return Boolean(active);
  };
  return semanticRetrieve;
}
