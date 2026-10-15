'use strict';

const { createContext, Script } = require('node:vm');

// The regular expressions a memory's check may use (spec section 6): at most 500
// characters, no backreference, and no repeated group that itself holds a
// quantifier or an alternation (the shapes of catastrophic backtracking). The
// guard is structural, so it is conservative; a slow pattern it lets through
// still ends at the matcher's timeout. A check never runs anything else.
const PATTERN_MAX = 500;

// The quantifier at i: its length and whether it can repeat more than once.
function quantifierAt(text, i) {
  const c = text[i];
  let length = 0;
  let repeats = false;
  if (c === '*' || c === '+') { length = 1; repeats = true; }
  else if (c === '?') length = 1;
  else if (c === '{') {
    const m = /^\{(\d+)(,(\d*))?\}/.exec(text.slice(i));
    if (!m) return null;
    length = m[0].length;
    repeats = m[2] ? (m[3] === '' || Number(m[3]) > 1) : Number(m[1]) > 1;
  } else return null;
  if (text[i + length] === '?') length += 1;
  return { length, repeats };
}

function patternProblem(source) {
  const text = String(source ?? '');
  if (!text) return 'empty_pattern';
  if (text.length > PATTERN_MAX) return 'pattern_too_long';
  const frames = [{ quantified: false, alternation: false }];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '(') {
      frames.push({ quantified: false, alternation: false });
      i += 1;
      if (text[i] === '?') {
        i += 1;
        if (text[i] === '<' && text[i + 1] !== '=' && text[i + 1] !== '!') { const end = text.indexOf('>', i); i = end < 0 ? text.length : end + 1; }
        else i += text[i] === '<' ? 2 : 1;
      }
      continue;
    }
    if (c === '|') { frames.at(-1).alternation = true; i += 1; continue; }
    if (c === ')') {
      if (frames.length < 2) return 'unbalanced_group';
      const group = frames.pop();
      i += 1;
      const q = quantifierAt(text, i);
      if (q?.repeats && (group.quantified || group.alternation)) return 'nested_quantifier';
      const parent = frames.at(-1);
      parent.quantified ||= group.quantified || Boolean(q);
      parent.alternation ||= group.alternation;
      if (q) i += q.length;
      continue;
    }
    // One atom: an escape, a character class or a single character.
    if (c === '\\') {
      const next = text[i + 1] ?? '';
      if (/[1-9]/.test(next) || next === 'k') return 'backreference';
      i += 2;
    } else if (c === '[') {
      i += 1;
      if (text[i] === '^') i += 1;
      // JavaScript, unlike PCRE: `[]` is an empty class and `[^]` any character,
      // so a `]` right after `[` or `[^` closes the class.
      while (i < text.length && text[i] !== ']') i += text[i] === '\\' ? 2 : 1;
      i += 1;
    } else i += 1;
    const q = quantifierAt(text, i);
    if (q) { frames.at(-1).quantified = true; i += q.length; }
  }
  return frames.length === 1 ? null : 'unbalanced_group';
}

const unsafePattern = source => patternProblem(source) !== null;

function compilePattern(source) {
  if (typeof source !== 'string' || unsafePattern(source)) return null;
  try { return new RegExp(source); } catch { return null; }
}

// Every evaluation runs in one reused vm context with a timeout, which interrupts
// a regular expression mid-match (measured: a catastrophic one stops at 51 ms; a
// call costs 0.1 ms). null means the pattern is invalid or the time ran out.
function createMatcher({ timeoutMs = 50 } = {}) {
  const context = createContext({ pattern: null, text: '' });
  const script = new Script('pattern.test(text)');
  const cache = new Map();
  return {
    test(pattern, text) {
      let compiled = pattern instanceof RegExp ? pattern : cache.get(pattern);
      if (compiled === undefined) { compiled = compilePattern(pattern); cache.set(pattern, compiled); }
      if (!compiled) return null;
      context.pattern = compiled;
      context.text = String(text ?? '');
      try { return script.runInContext(context, { timeout: timeoutMs }) === true; } catch { return null; }
    },
  };
}

module.exports = { PATTERN_MAX, patternProblem, unsafePattern, compilePattern, createMatcher };
