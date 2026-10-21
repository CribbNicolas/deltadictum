import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePattern, createMatcher, patternProblem, unsafePattern } from '../../../src/checks/pattern.cjs';
import { SPIKE_CHECKS, SPIKE_COMMAND_CHECKS } from '../../../src/eval/v2bench/spike-checks.js';

test('quantified groups that hold a quantifier or an alternation, and backreferences, are refused', () => {
  for (const source of ['(a+)+', '(a+)+$', '(?:\\w*)*x', '(a|aa)+', '((ab)*)+', '(a*)*', '(\\w+\\s?)+', '(.*a){3}', '(?:x|y)*', '((a|b)c)+',
    '(a)\\1', '(?<n>a)\\k<n>', 'x'.repeat(501),
    // In JavaScript `[]` is an empty class and `[^]` any character: the group after it is real.
    '[]|(a+)+$|]', '[^](a+)+']) {
    assert.ok(patternProblem(source), source);
    assert.equal(unsafePattern(source), true, source);
    assert.equal(compilePattern(source), null, source);
  }
});

test('ordinary check patterns pass', () => {
  for (const source of ['createMemoryStore\\(', 't\\.after\\(', '^import .* from', '(?:foo|bar)\\b', '[a-z]+\\d*', 'x{2,5}', '(abc)?', '(?<!x)y',
    '(?:a|b)?', '[(]+', '\\(+', ...SPIKE_CHECKS.flatMap(s => [s.check.if_content, s.check.unless_content].filter(Boolean)),
    ...SPIKE_COMMAND_CHECKS.map(s => s.check.if_command)]) {
    assert.equal(patternProblem(source), null, source);
    assert.ok(compilePattern(source) instanceof RegExp, source);
  }
  assert.equal(patternProblem(''), 'empty_pattern');
  assert.equal(compilePattern('(unclosed'), null);
  assert.equal(compilePattern(42), null);
});

test('a slow pattern that passes the guard times out instead of hanging', () => {
  const matcher = createMatcher({ timeoutMs: 50 });
  const started = Date.now();
  assert.equal(matcher.test('a*a*a*a*a*a*b', 'a'.repeat(3000)), null);
  assert.ok(Date.now() - started < 1000);
  assert.equal(matcher.test('t\\.after\\(', 't.after(() => store.close())'), true);
  assert.equal(matcher.test('t\\.after\\(', 'store.close()'), false);
  assert.equal(matcher.test('(a+)+', 'aaa'), null);
});
