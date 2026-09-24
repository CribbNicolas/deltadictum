import { createHash } from 'node:crypto';

// What a memory is found by: the situation it applies to, then what it says.
// The trigger leads because a request describes a situation, not advice.
export function passageText(atom) {
  return [atom.title, atom.trigger, ...(atom.trigger_variants ?? []), atom.behavior_delta].filter(Boolean).join('. ');
}

const hashOf = text => createHash('sha256').update(text).digest('hex').slice(0, 16);
const toBlob = vector => Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
const fromBlob = blob => new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));

// Embed every live memory whose text or model changed since it was last
// embedded. Returns the vectors of the live set, keyed by atom id.
export async function syncVectors({ store, projectId, embedder, states = ['active', 'contested'] }) {
  const db = store.index.db;
  const atoms = await store.listAtoms({ projectId, lifecycleStates: states });
  const known = new Map(db.prepare('SELECT atom_id, text_hash, vector FROM memory_vectors WHERE model = ?').all(embedder.model)
    .map(row => [row.atom_id, row]));
  const stale = atoms.filter(atom => known.get(atom.id)?.text_hash !== hashOf(passageText(atom)));
  for (let i = 0; i < stale.length; i += 16) {
    const batch = stale.slice(i, i + 16);
    const vectors = await embedder.embed(batch.map(passageText), 'passage');
    const upsert = db.prepare(`INSERT INTO memory_vectors (atom_id, model, text_hash, vector) VALUES (?, ?, ?, ?)
      ON CONFLICT(atom_id, model) DO UPDATE SET text_hash = excluded.text_hash, vector = excluded.vector`);
    batch.forEach((atom, j) => {
      upsert.run(atom.id, embedder.model, hashOf(passageText(atom)), toBlob(vectors[j]));
      known.set(atom.id, { vector: toBlob(vectors[j]) });
    });
  }
  return new Map(atoms.map(atom => [atom.id, fromBlob(known.get(atom.id).vector)]));
}

export function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
  return dot; // vectors are normalised by the embedder
}
