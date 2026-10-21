import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWhen, evaluateCommand, evaluateContent, exampleProblems } from '../../src/checks/check.cjs';
import { createMatcher } from '../../src/checks/pattern.cjs';

const matcher = createMatcher();
const store = { on: ['edit', 'write'], paths: ['tests/**/*.test.js'], if_content: 'createMemoryStore\\(', unless_content: 't\\.after\\(',
  say: 'Close the store in t.after.', examples: { violates: 'const s = await createMemoryStore(d);', passes: 'const s = await createMemoryStore(d);\nt.after(() => s.close());' } };
const force = { on: ['run'], if_command: '--test-force-exit', say: 'Crashes on Windows.', examples: { violates: 'node --test --test-force-exit', passes: 'node --test' } };

test('a violation is the first pattern matching and the second not', () => {
  assert.deepEqual(evaluateContent(store, 'await createMemoryStore(d)', matcher), { violated: true, timedOut: false });
  assert.deepEqual(evaluateContent(store, 'await createMemoryStore(d); t.after(() => 1)', matcher), { violated: false, timedOut: false });
  assert.deepEqual(evaluateContent(store, 'nothing here', matcher), { violated: false, timedOut: false });
  assert.deepEqual(evaluateCommand(force, 'node --test --test-force-exit x', matcher), { violated: true, timedOut: false });
});

test('only the first 256 KB of a file is evaluated', () => {
  assert.equal(evaluateContent(store, `${' '.repeat(262144)}createMemoryStore(d)`, matcher).violated, false);
});

test('examples must behave as stated; a timeout is its own problem', () => {
  assert.deepEqual(exampleProblems(store, matcher), []);
  assert.deepEqual(exampleProblems(force, matcher), []);
  assert.deepEqual(exampleProblems({ ...store, examples: { violates: 'x', passes: 'createMemoryStore(' } }, matcher),
    ['check_misses_its_violating_example', 'check_flags_its_passing_example']);
  const slow = { ...store, if_content: 'a*a*a*a*a*a*b', unless_content: undefined, examples: { violates: 'a'.repeat(3000), passes: '' } };
  assert.deepEqual(exampleProblems(slow, createMatcher({ timeoutMs: 20 })), ['check_timed_out']);
});

// A pattern that does not compile is its own problem, not a timeout: the person
// fixing the check must know which.
test('an invalid pattern is reported as such, not as a timeout', () => {
  assert.deepEqual(exampleProblems({ ...store, if_content: 'a(' }, matcher), ['invalid_check_pattern']);
  assert.deepEqual(exampleProblems({ ...store, unless_content: '(a+)+' }, matcher), ['invalid_check_pattern']);
  assert.deepEqual(exampleProblems({ ...force, if_command: '' }, matcher), ['invalid_check_pattern']);
});

test('the default moment', () => {
  assert.equal(defaultWhen(store), 'turn');
  assert.equal(defaultWhen({ ...store, when: 'edit' }), 'edit');
  assert.equal(defaultWhen(force), 'run');
});
