import { join } from 'node:path';
import { resolveDataBase } from '../project.js';

// The embedding runtime is an optional dependency, loaded only by a long-lived
// process (L1: a cached model takes ~0.5 s to load). A missing runtime or model
// is reported as null, and callers fall back to lexical retrieval (L5).
export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';
// DD_EMBED_MODEL picks the model for the machine's one resident (L2). Both e5
// models share the default calibration. On the golden sets (2026-09-28)
// multilingual-e5-base tied e5-small over both halves at the same floor (79 vs 78
// events with every must memory, 51 vs 53 quiet negatives), for +175 MB resident
// memory and about 30% more time per query, so e5-small stays the default.
export const SUPPORTED_MODELS = Object.freeze(['Xenova/multilingual-e5-small', 'Xenova/multilingual-e5-base']);
export function configuredModel(env = process.env) {
  const wanted = String(env.DD_EMBED_MODEL ?? '').trim();
  if (!wanted) return DEFAULT_MODEL;
  return SUPPORTED_MODELS.find(model => model === wanted || model.endsWith(`/${wanted}`)) ?? DEFAULT_MODEL;
}

// e5 models are trained with these prefixes; without them similarity degrades.
const PREFIX = { query: 'query: ', passage: 'passage: ' };

export async function loadEmbedder({ model = configuredModel(), cacheDir = join(resolveDataBase(), 'models') } = {}) {
  let transformers;
  try { transformers = await import('@huggingface/transformers'); }
  catch { return null; }
  transformers.env.cacheDir = cacheDir;
  const extract = await transformers.pipeline('feature-extraction', model, { dtype: 'q8' });
  async function embed(texts, kind) {
    const output = await extract(texts.map(text => PREFIX[kind] + text), { pooling: 'mean', normalize: true });
    const [rows, dims] = output.dims;
    return Array.from({ length: rows }, (_, i) => output.data.slice(i * dims, (i + 1) * dims));
  }
  return { model, embed };
}
