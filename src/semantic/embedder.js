import { join } from 'node:path';
import { resolveDataBase } from '../project.js';

// The embedding runtime is an optional dependency, loaded only by a long-lived
// process (L1: a cached model takes ~0.5 s to load). A missing runtime or model
// is reported as null, and callers fall back to lexical retrieval (L5).
export const DEFAULT_MODEL = 'Xenova/multilingual-e5-small';

// e5 models are trained with these prefixes; without them similarity degrades.
const PREFIX = { query: 'query: ', passage: 'passage: ' };

export async function loadEmbedder({ model = DEFAULT_MODEL, cacheDir = join(resolveDataBase(), 'models') } = {}) {
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
