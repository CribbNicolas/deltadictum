import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compilePattern, unsafePattern } from '../../../src/checks/pattern.js';

test('a long pattern or a quantified quantified group is unsafe', () => {
  assert.equal(unsafePattern('(a+)+$'), true);
  assert.equal(unsafePattern('(?:\\w*)*x'), true);
  assert.equal(unsafePattern('x'.repeat(501)), true);
  assert.equal(unsafePattern('t\\.after\\('), false);
});

test('a safe pattern compiles; an unsafe, empty, invalid or non-string one does not', () => {
  assert.ok(compilePattern('t\\.after\\(') instanceof RegExp);
  assert.equal(compilePattern('(a+)+'), null);
  assert.equal(compilePattern(''), null);
  assert.equal(compilePattern('(unclosed'), null);
  assert.equal(compilePattern(42), null);
});
