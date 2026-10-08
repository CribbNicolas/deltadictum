import { containsPhrase, words } from './text.js';

// The reference semantics of a v2 trigger clause (docs/superpowers/specs/
// 2026-10-08-dd-v2-design.md, section 3), written for clarity, not speed: the
// compiled matcher must agree with it on every event.

export const EVENT_KINDS = ['read', 'edit', 'write', 'search', 'run', 'prompt'];
export const DIMENSIONS = ['paths', 'symbols', 'commands', 'keywords'];
const KEYWORD_KINDS = ['prompt', 'search'];

const globs = new Map();
// A glob over repository-relative paths: `**/` crosses any number of folders, a
// trailing `**` matches the rest, `*` and `?` stay within one segment.
export function globToRegExp(glob) {
  const source = String(glob).replaceAll('\\', '/').replace(/^\.\//, '');
  if (globs.has(source)) return globs.get(source);
  let out = '';
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (c === '*' && source[i + 1] === '*') {
      i += 1;
      if (source[i + 1] === '/') { i += 1; out += '(?:.*/)?'; } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  const regex = new RegExp(`^${out}$`);
  globs.set(source, regex);
  return regex;
}

const escape = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// An identifier, or a dotted name, as a whole token: `openStore` does not match `reopenStore`.
export const hasSymbol = (text, symbol) => new RegExp(`(?<![\\w$])${escape(symbol)}(?![\\w$])`).test(String(text ?? ''));

const shellTokens = text => String(text ?? '').trim().split(/\s+/).filter(Boolean);
// The command contains the pattern's tokens in sequence, whitespace normalized.
export function hasCommand(command, pattern) {
  const hay = shellTokens(command);
  const needle = shellTokens(pattern);
  return needle.length > 0 && hay.some((_, i) => needle.every((token, j) => hay[i + j] === token));
}

// A `not` entry with a glob character or a folder separator cancels by path; any other, by phrase.
const isGlob = entry => /[*?/]/.test(entry);

// Whether the clause matches the event, and the dimensions it matched on. A
// clause that states no dimension besides `on` never matches.
export function clauseMatches(clause, event) {
  const none = { matched: false, via: [] };
  if (!Array.isArray(clause?.on) || !clause.on.includes(event?.kind)) return none;
  const stated = DIMENSIONS.filter(dimension => Array.isArray(clause[dimension]) && clause[dimension].length);
  if (!stated.length) return none;
  const paths = event.paths ?? [];
  const text = event.text ?? '';
  const textWords = words(text);
  const test = {
    paths: () => clause.paths.some(glob => paths.some(path => globToRegExp(glob).test(path))),
    symbols: () => clause.symbols.some(symbol => hasSymbol(text, symbol)),
    commands: () => event.kind === 'run' && clause.commands.some(pattern => hasCommand(text, pattern)),
    keywords: () => KEYWORD_KINDS.includes(event.kind) && clause.keywords.some(phrase => containsPhrase(textWords, words(phrase))),
  };
  if (!stated.every(dimension => test[dimension]())) return none;
  const cancelled = (clause.not ?? []).some(entry => (isGlob(entry)
    ? paths.some(path => globToRegExp(entry).test(path))
    : containsPhrase(textWords, words(entry))));
  return cancelled ? none : { matched: true, via: stated };
}

// The memory's best clause for the event: the one matching on most dimensions.
export function memoryMatch(memory, event) {
  let best = null;
  for (const clause of memory?.triggers ?? []) {
    const result = clauseMatches(clause, event);
    if (result.matched && (!best || result.via.length > best.via.length)) best = result;
  }
  return best;
}
