import { namedSymbols } from '../capture/generic.js';
import { words } from '../engine/text.cjs';

// Lexical similarity, out of session only (spec section 8): an FTS5 table of
// titles and bodies in telemetry.sqlite. It flags duplicates and overlaps for
// review, suggests triggers and serves `deltadictum recall`; it never decides
// delivery.
const SCHEMA = 'CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(id UNINDEXED, topic, title, body)';
// Only what can still be delivered or reviewed: superseded versions would outrank
// the memories that replaced them (seen: 69 of them on one store).
export const SIMILAR_STATUSES = ['active', 'contested', 'candidate'];
const INDEX_REVISION = 'v2';

export function refreshSimilarity(root, db, memories, hash) {
  db.exec(SCHEMA);
  const key = `${INDEX_REVISION}:${hash}`;
  if (db.prepare("SELECT value FROM meta WHERE key = 'similarity_hash'").get()?.value === key) return false;
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM memories_fts');
    const insert = db.prepare('INSERT INTO memories_fts (id, topic, title, body) VALUES (?, ?, ?, ?)');
    for (const memory of memories.filter(m => SIMILAR_STATUSES.includes(m.status))) insert.run(memory.id, memory.topic, memory.title, memory.body);
    db.prepare("INSERT INTO meta (key, value) VALUES ('similarity_hash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return true;
}

// Function words match everything and rank nothing.
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'what', 'which', 'are', 'was', 'were',
  'has', 'have', 'not', 'but', 'its', 'can', 'all', 'any', 'how', 'why', 'out', 'use']);

// Words only, each quoted: nothing a person or a memory writes is FTS5 syntax.
export function ftsQuery(text) {
  const terms = [...new Set(words(text).filter(word => word.length > 2 && !STOP.has(word)))].slice(0, 16);
  return terms.length ? terms.map(term => `"${term.replaceAll('"', '')}"`).join(' OR ') : null;
}

export function similarTo(db, text, { limit = 5, exclude = [] } = {}) {
  const query = ftsQuery(text);
  if (!query) return [];
  const skip = new Set(exclude);
  try {
    return db.prepare('SELECT id, bm25(memories_fts) AS rank FROM memories_fts WHERE memories_fts MATCH ? ORDER BY rank LIMIT ?')
      .all(query, limit + skip.size).filter(row => !skip.has(row.id)).slice(0, limit).map(row => ({ id: row.id, rank: row.rank }));
  } catch { return []; }
}

function jaccard(a, b) {
  const x = new Set(words(a));
  const y = new Set(words(b));
  const shared = [...x].filter(word => y.has(word)).length;
  return shared / Math.max(1, x.size + y.size - shared);
}
const anchors = memory => new Set(memory.triggers.flatMap(clause => [...(clause.paths ?? []), ...(clause.symbols ?? [])]));

// Pairs for review: near-identical bodies are duplicates; similar bodies on the
// same anchors are overlaps a person reads (a duplicate or a contradiction).
export function overlaps(memories, db, { duplicate = 0.6, overlap = 0.3 } = {}) {
  const byId = new Map(memories.map(memory => [memory.id, memory]));
  const pairs = new Map();
  for (const memory of memories) {
    for (const { id } of similarTo(db, `${memory.title} ${memory.body}`, { limit: 3, exclude: [memory.id] })) {
      const other = byId.get(id);
      if (!other) continue;
      const [a, b] = [memory.id, id].sort();
      if (pairs.has(`${a}\0${b}`)) continue;
      const similarity = jaccard(memory.body, other.body);
      const shared = [...anchors(memory)].some(anchor => anchors(other).has(anchor));
      const kind = similarity >= duplicate ? 'duplicate' : shared && similarity >= overlap ? 'overlap' : null;
      if (kind) pairs.set(`${a}\0${b}`, { a, b, kind, similarity: Math.round(similarity * 100) / 100 });
    }
  }
  return [...pairs.values()];
}

// For a memory with no triggers: the repository paths
// and the code symbols its body names.
export function suggestTriggersFor(memory, { repoFiles = [], symbolExists = () => false } = {}) {
  const text = `${memory.title ?? ''}\n${memory.body ?? ''}`;
  const paths = [...new Set(text.match(/[\w.@-]+(?:\/[\w.@-]+)+/g) ?? [])].map(path => path.replace(/[.,;:]+$/, ''))
    .filter(path => repoFiles.includes(path)).slice(0, 12);
  const symbols = namedSymbols(memory).filter(name => !name.includes('/') && symbolExists(name)).slice(0, 12);
  return [...(paths.length ? [{ on: ['read', 'edit', 'write'], paths }] : []), ...(symbols.length ? [{ on: ['edit', 'write'], symbols }] : [])];
}
