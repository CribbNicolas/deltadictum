import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examplesHold, scoreCheck, scoreCommandCheck, unsafePattern, violates } from '../../../src/eval/v2bench/checks.js';
import { SPIKE_CHECKS, SPIKE_COMMAND_CHECKS } from '../../../src/eval/v2bench/spike-checks.js';

const check = { on: ['edit'], paths: ['tests/**/*.test.js'], if_content: 'createMemoryStore', unless_content: 't\\.after\\(',
  examples: { violates: 'createMemoryStore(d)', passes: 'createMemoryStore(d); t.after(() => 1)' } };

test('a violation needs if_content and no unless_content', () => {
  assert.equal(violates(check, 'const s = createMemoryStore(d);'), true);
  assert.equal(violates(check, 'const s = createMemoryStore(d); t.after(() => s.close());'), false);
  assert.equal(violates(check, 'assert.ok(1)'), false);
  assert.equal(examplesHold(check), true);
  assert.equal(examplesHold({ ...check, examples: { violates: 'nothing', passes: 'x' } }), false);
});

test('long patterns and quantified quantified groups are unsafe', () => {
  assert.equal(unsafePattern('(a+)+$'), true);
  assert.equal(unsafePattern('(?:\\w*)*x'), true);
  assert.equal(unsafePattern('x'.repeat(501)), true);
  assert.equal(unsafePattern(String.raw`--test\b[^"\n]*\s(?!\\")[^\s"\\]*\*`), false);
});

test('every spike check holds on its own examples and is safe', () => {
  for (const spec of SPIKE_CHECKS) {
    assert.equal(examplesHold(spec.check), true, spec.memory);
    assert.equal(unsafePattern(spec.check.if_content) || Boolean(spec.check.unless_content && unsafePattern(spec.check.unless_content)), false, spec.memory);
  }
});

test('the glob check flags an unquoted glob in package.json and not a quoted one', () => {
  const globs = SPIKE_CHECKS.find(spec => spec.requirement === 'globs_quoted').check;
  assert.equal(violates(globs, '    "test:cognition": "node --import ./h.js --test --test-concurrency=1 tests/engine/cognition/**/*.test.js",'), true);
  assert.equal(violates(globs, '    "test:cognition": "node --import ./h.js --test --test-concurrency=1 \\"tests/engine/cognition/**/*.test.js\\"",'), false);
});

test('a check is scored against each run verdict on the files it covers', () => {
  const fixture = { runs: [
    { run_id: 'a', verdicts: { closed: false }, added: { 'tests/x.test.js': 'createMemoryStore(d)' }, events: [] },
    { run_id: 'b', verdicts: { closed: true }, added: { 'tests/x.test.js': 'createMemoryStore(d); t.after(() => 1)' }, events: [] },
    { run_id: 'c', verdicts: { closed: true }, added: { 'tests/x.test.js': 'createMemoryStore(d)' }, events: [] },
    { run_id: 'd', verdicts: { closed: false }, added: { 'tests/x.test.js': 'nothing here' }, events: [] },
    { run_id: 'e', verdicts: { closed: null }, added: { 'tests/x.test.js': 'createMemoryStore(d)' }, events: [] },
    { run_id: 'f', verdicts: {}, added: { 'src/x.js': 'createMemoryStore(d)' }, events: [] },
  ] };
  const score = scoreCheck({ memory: 'm', requirement: 'closed', check }, fixture);
  assert.deepEqual({ tp: score.tp, fp: score.fp, fn: score.fn, tn: score.tn, fired: score.fired, runs_seen: score.runs_seen },
    { tp: 1, fp: 1, fn: 1, tn: 1, fired: 3, runs_seen: 5 });
  assert.deepEqual(score.cases, [{ run_id: 'c', outcome: 'fp' }, { run_id: 'd', outcome: 'fn' }]);
  assert.equal(score.examples_hold, true);
});

test('a command check counts the runs it would speak in', () => {
  const fixture = { runs: [
    { run_id: 'a', events: [{ kind: 'run', text: 'node --test --test-force-exit tests/hooks/resident.test.js' }] },
    { run_id: 'b', events: [{ kind: 'run', text: 'node --test tests/a.test.js' }, { kind: 'search', text: '--test-force-exit' }] },
  ] };
  assert.deepEqual(scoreCommandCheck(SPIKE_COMMAND_CHECKS[0], fixture), { memory: SPIKE_COMMAND_CHECKS[0].memory, fired: 1, runs: ['a'] });
});

test('the production check module scores the spike checks with no false positive and examples that hold', async () => {
  const { loadFixture } = await import('../../../src/eval/v2bench/fixture.js');
  const fixture = await loadFixture();
  for (const spec of SPIKE_CHECKS) {
    const score = scoreCheck(spec, fixture);
    assert.equal(score.examples_hold, true, spec.memory);
    assert.equal(score.fp, 0, spec.memory);
    assert.equal(score.engine, 'production');
  }
});
