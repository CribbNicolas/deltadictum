'use strict';

const { PATH_FLAGS, hasTokens, shellTokens, symbolPattern } = require('./clause.cjs');
const { containsPhrase, words } = require('./text.cjs');

// The compiled matcher: the same answers as memoryMatch in clause.cjs on every
// event (tests/engine/match.test.js checks every event of the bench fixture),
// with globs and symbols compiled once per hook and clauses grouped by event kind.
const KIND_ORDER = ['trap', 'decision', 'fact', 'failed_approach', 'procedure'];

// Clauses are grouped by event kind, and a kind's patterns are compiled only when
// an event of that kind asks: a hook sees one event.
function prepareIndex(index) {
  const raw = {};
  for (const clause of index.clauses) for (const kind of clause.on) (raw[kind] ??= []).push(clause);
  const prepared = {};
  const compile = clause => ({ ...clause,
    paths: clause.paths?.map(source => new RegExp(source, PATH_FLAGS)),
    not_paths: clause.not_paths?.map(source => new RegExp(source, PATH_FLAGS)),
    symbols: clause.symbols?.map(symbolPattern) });
  return { memories: index.memories, clausesFor: kind => (prepared[kind] ??= (raw[kind] ?? []).map(compile)) };
}

function clauseHolds(clause, event, text, lazyWords) {
  const paths = event.paths ?? [];
  for (const dimension of clause.dims) {
    if (dimension === 'paths' && !clause.paths.some(regex => paths.some(path => regex.test(path)))) return false;
    if (dimension === 'symbols' && (event.kind === 'prompt' || !clause.symbols.some(regex => regex.test(text)))) return false;
    if (dimension === 'commands' && (event.kind !== 'run' || !clause.commands.some(tokens => hasTokens(shellTokens(text), tokens)))) return false;
    if (dimension === 'keywords' && ((event.kind !== 'prompt' && event.kind !== 'search') || !clause.keywords.some(phrase => containsPhrase(lazyWords(), phrase)))) return false;
  }
  if (clause.not?.some(phrase => containsPhrase(lazyWords(), phrase))) return false;
  if (clause.not_paths?.some(regex => paths.some(path => regex.test(path)))) return false;
  return true;
}

function matchEvent(runtime, event) {
  const clauses = runtime.clausesFor(event?.kind);
  const text = String(event.text ?? '');
  let cached = null;
  const lazyWords = () => (cached ??= words(text));
  const best = new Map();
  for (const clause of clauses) {
    if (!clause.dims.length) continue;
    const previous = best.get(clause.m);
    // The reference keeps the first clause with the most dimensions: an equal one later changes nothing.
    if (previous && previous.via.length >= clause.dims.length) continue;
    if (clauseHolds(clause, event, text, lazyWords)) best.set(clause.m, { id: clause.m, via: clause.dims });
  }
  const rank = id => KIND_ORDER.indexOf(runtime.memories[id]?.kind);
  return [...best.values()].sort((a, b) => b.via.length - a.via.length || rank(a.id) - rank(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

module.exports = { KIND_ORDER, prepareIndex, matchEvent };
