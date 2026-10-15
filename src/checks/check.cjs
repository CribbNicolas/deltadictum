'use strict';

const { closeSync, openSync, readSync } = require('node:fs');
const { compilePattern } = require('./pattern.cjs');

// A check (spec section 6) says when a rule is broken: the `if_` pattern matches
// and the `unless_` pattern, when stated, does not. Patterns only; at most the
// first 256 KB of a file; a timeout is silence.
const CONTENT_MAX = 256 * 1024;
const PATTERN_KEYS = ['if_content', 'unless_content', 'if_command', 'unless_command'];

// The first `max` bytes of a file, what a check judges; null when it cannot be read.
function readHead(file, max = CONTENT_MAX) {
  let fd;
  try { fd = openSync(file, 'r'); } catch { return null; }
  try {
    const buffer = Buffer.alloc(max);
    const read = readSync(fd, buffer, 0, max, 0);
    return buffer.subarray(0, read).toString('utf8');
  } catch { return null; } finally { closeSync(fd); }
}

function violation(check, text, matcher, kind) {
  const [ifKey, unlessKey] = kind === 'command' ? ['if_command', 'unless_command'] : ['if_content', 'unless_content'];
  const subject = String(text ?? '').slice(0, CONTENT_MAX);
  const hit = matcher.test(check[ifKey], subject);
  if (hit === null) return { violated: false, timedOut: true };
  if (!hit) return { violated: false, timedOut: false };
  if (!check[unlessKey]) return { violated: true, timedOut: false };
  const excused = matcher.test(check[unlessKey], subject);
  if (excused === null) return { violated: false, timedOut: true };
  return { violated: !excused, timedOut: false };
}

const evaluateContent = (check, text, matcher) => violation(check, text, matcher, 'content');
const evaluateCommand = (check, command, matcher) => violation(check, command, matcher, 'command');
// `turn` for file checks unless the memory says `edit`; command checks run with their command.
const defaultWhen = check => (check.if_content ? (check.when === 'edit' ? 'edit' : 'turn') : 'run');

function exampleProblems(check, matcher) {
  if (typeof check?.examples?.violates !== 'string' || typeof check?.examples?.passes !== 'string') return ['check_examples_required'];
  // A pattern that does not compile is its own problem, not a timeout.
  if (PATTERN_KEYS.some(key => check[key] !== undefined && !compilePattern(check[key]))) return ['invalid_check_pattern'];
  const kind = check.if_content ? 'content' : 'command';
  const bad = violation(check, check.examples.violates, matcher, kind);
  const good = violation(check, check.examples.passes, matcher, kind);
  if (bad.timedOut || good.timedOut) return ['check_timed_out'];
  return [...(bad.violated ? [] : ['check_misses_its_violating_example']), ...(good.violated ? ['check_flags_its_passing_example'] : [])];
}

module.exports = { CONTENT_MAX, readHead, evaluateContent, evaluateCommand, defaultWhen, exampleProblems };
