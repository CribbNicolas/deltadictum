'use strict';

const { globToRegExp } = require('../engine/clause.cjs');

// A check (spec section 6) says when a rule is broken: the `if_` pattern matches
// and the `unless_` pattern, when stated, does not. Patterns only; at most the
// first 256 KB of a file; a timeout is silence.
const CONTENT_MAX = 256 * 1024;

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
const appliesTo = (check, path) => (check.paths ?? []).some(glob => globToRegExp(glob).test(String(path)));
// `turn` for file checks unless the memory says `edit`; command checks run with their command.
const defaultWhen = check => (check.if_content ? (check.when === 'edit' ? 'edit' : 'turn') : 'run');

function exampleProblems(check, matcher) {
  if (typeof check?.examples?.violates !== 'string' || typeof check?.examples?.passes !== 'string') return ['check_examples_required'];
  const kind = check.if_content ? 'content' : 'command';
  const bad = violation(check, check.examples.violates, matcher, kind);
  const good = violation(check, check.examples.passes, matcher, kind);
  if (bad.timedOut || good.timedOut) return ['check_timed_out'];
  return [...(bad.violated ? [] : ['check_misses_its_violating_example']), ...(good.violated ? ['check_flags_its_passing_example'] : [])];
}

module.exports = { CONTENT_MAX, evaluateContent, evaluateCommand, appliesTo, defaultWhen, exampleProblems };
