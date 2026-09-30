import { retrieveMemories } from '../engine/retrieve.js';
import { loadEmbedder } from './embedder.js';
import { syncVectors, cosine } from './vectors.js';
import { RECALL_STATES } from '../store/paths.js';

// Embedding similarities from multilingual-e5 are compressed (0.75-0.90 for
// related and unrelated text alike), so the signal is how far a memory stands
// above the query's own mean similarity, not the raw value. Only the top
// `topK` memories are considered, and a margin below `floor` contributes
// nothing, which is what lets an unrelated request abstain.
//
// Recall comes first: an extra memory costs less than a missing essential one.
// Re-gridded on the Patriark and supermem benchmarks with the hubness discount
// (2026-09-26): 0.035 raised Patriark must-recall 0.29 -> 0.32 and orbit recall
// 0.09 -> 0.15 at the same precision and quiet negatives as 0.04; 0.03 broke
// the negatives in both projects.
export const DEFAULT_CALIBRATION = Object.freeze({ floor: 0.035, full: 0.065, topK: 20 });
export const PROMPT_FLOOR_OFFSET = 0.01;

// Tool calls arrive as `Tool {json}`; the keys and punctuation are noise to an
// embedding model, the paths and strings are the content.
export function queryText(action) {
  return String(action ?? '').replace(/"(file_path|old_string|new_string|command|pattern|path|content|input)"\s*:/g, ' ')
    .replace(/[{}"\\[\],]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
}

export function semanticActivation(sims, { floor, full, topK } = DEFAULT_CALIBRATION, hub) {
  if (hub?.size) sims = new Map([...sims].map(([id, sim]) => [id, sim - (hub.get(id) ?? 0)]));
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

// Every memory's position (1 = nearest) by hub-discounted similarity: the dense
// ranked list that retrieval fuses with the full-text one.
export function semanticRanks(sims, hub) {
  const adjusted = [...sims].map(([id, sim]) => [id, sim - (hub?.get(id) ?? 0)]).sort((a, b) => b[1] - a[1]);
  return new Map(adjusted.map(([id], i) => [id, i + 1]));
}

// How far each memory's vector sits above the store's average closeness to
// everything else, centred on zero. A long memory that lists many nouns is
// near every query ("hub"), and would otherwise top unrelated requests. It is
// derived from the store alone, never from past requests (L6: no online learning).
// Chosen on the Patriark and supermem benchmarks (2026-09-26): at the default
// floor it kept must-recall and quieted every negative task in both.
export function hubness(vectors) {
  const ids = [...vectors.keys()];
  if (ids.length < 3) return new Map();
  const sums = new Float64Array(ids.length);
  for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) {
    const sim = cosine(vectors.get(ids[i]), vectors.get(ids[j]));
    sums[i] += sim; sums[j] += sim;
  }
  const raw = new Map(ids.map((id, i) => [id, sums[i] / (ids.length - 1)]));
  const mean = [...raw.values()].reduce((a, b) => a + b, 0) / raw.size;
  return new Map([...raw].map(([id, value]) => [id, value - mean]));
}

// `blocking: false` is for the resident process answering hooks: until the model
// has loaded, a request is answered lexically instead of waiting on it (L5).
export function createSemanticRetrieve({ embedder: given, calibration = DEFAULT_CALIBRATION, load = loadEmbedder, blocking = true } = {}) {
  let embedder = given;
  let loading;
  // Hubness is quadratic in the store; recompute it only when the live vectors change.
  const hubs = new Map();
  function hubOf(projectId, vectors) {
    const signature = [...vectors].map(([id, v]) => `${id}:${v[0]}`).join('|');
    const cached = hubs.get(projectId);
    if (cached?.signature === signature) return cached.hub;
    const hub = hubness(vectors);
    hubs.set(projectId, { signature, hub });
    return hub;
  }
  const start = () => (loading ??= Promise.resolve().then(load).then(ready => { embedder = ready; return ready; }, () => null));
  async function ready() {
    if (embedder !== undefined) return embedder;
    return blocking ? start() : (start(), undefined);
  }
  async function semanticRetrieve(request, deps) {
    const active = await ready();
    if (!active) return retrieveMemories(request, deps);
    const vectors = await syncVectors({ store: deps.store, projectId: request.project_id, embedder: active, states: RECALL_STATES });
    const [query] = await active.embed([queryText(request.action)], 'query');
    const sims = new Map([...vectors].map(([id, vector]) => [id, cosine(query, vector)]));
    // semantic.floor in .dd/config.json trades silence for recall per project:
    // terse memories need a lower floor to be reached at all.
    let floor = Number((await deps.store.loadConfig()).semantic?.floor);
    if (!Number.isFinite(floor) || floor < 0 || floor >= 1) floor = calibration.floor;
    // A prompt says what the person is after; a tool call is mostly paths and
    // code. On the golden sets' tuning halves (2026-09-28), a floor 0.01 lower for
    // prompts raised must-recall in both projects (0.54 -> 0.57, 0.43 -> 0.53);
    // raising it for tool calls cost supermem recall, and adding the previous
    // prompt as context helped one project and hurt the other.
    if (request.source === 'prompt') floor = Math.max(0, floor - PROMPT_FLOOR_OFFSET);
    const tuned = { ...calibration, floor, full: floor + (calibration.full - calibration.floor) };
    const hub = hubOf(request.project_id, vectors);
    return retrieveMemories(request, { ...deps, semantic: semanticActivation(sims, tuned, hub), semanticRank: semanticRanks(sims, hub) });
  }
  // Load the model before any project asks, so a fresh resident is ready sooner.
  semanticRetrieve.preload = async () => Boolean(await start());
  // Load the model and embed the store ahead of the first hook, so the first
  // bridged call does not pay for either.
  semanticRetrieve.warm = async ({ store, projectId }) => {
    const active = await start();
    if (active) hubOf(projectId, await syncVectors({ store, projectId, embedder: active, states: RECALL_STATES }));
    return Boolean(active);
  };
  // The memories nearest to one memory or a text, in any state but rejected:
  // what /dd:compact and /dd:prospect use to find overlaps. Read-only.
  semanticRetrieve.similar = async ({ store, projectId, id, text, limit = 8 }) => {
    const active = await ready();
    if (!active) return { error: { code: 503, message: 'The embedding model is not ready.' } };
    const states = ['candidate', 'active', 'contested', 'superseded', 'legacy', 'archived'];
    const vectors = await syncVectors({ store, projectId, embedder: active, states });
    // An id or a topic key, as `get` accepts.
    const target = id ? (await store.getAtom(id, projectId))?.id ?? id : null;
    const probe = target ? vectors.get(target) : (await active.embed([queryText(text)], 'query'))[0];
    if (!probe) return { error: { code: 404, message: `not_found:${id}` } };
    const ranked = [...vectors].filter(([other]) => other !== target).map(([other, vector]) => [other, cosine(probe, vector)])
      .sort((a, b) => b[1] - a[1]).slice(0, Math.min(20, Math.max(1, Number(limit) || 8)));
    return { similar: await Promise.all(ranked.map(async ([other, similarity]) => {
      const atom = await store.getAtom(other, projectId);
      return { id: other, topic_key: atom.topic_key, title: atom.title, lifecycle_state: atom.lifecycle_state,
        similarity: Math.round(similarity * 1000) / 1000 };
    })) };
  };
  return semanticRetrieve;
}
