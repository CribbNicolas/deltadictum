import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCommand, suiteOutcome } from '../../../src/eval/bench/suite.js';

const runs = (...results) => { const queue = [...results]; return async () => queue.shift(); };
const never = async () => { throw new Error('baseline must not run'); };

test('a first pass, or known flaky failures only, pass without a second run', async () => {
  assert.equal((await suiteOutcome(runs({ passed: true, failed: [] }), never)).passed, true);
  const flaky = await suiteOutcome(runs({ passed: false, failed: ['lock'] }), never, ['lock']);
  assert.equal(flaky.passed, true);
  assert.equal(flaky.first_passed, false);
});

test('a second pass is flakiness, not a regression', async () => {
  const out = await suiteOutcome(runs({ passed: false, failed: ['a'] }, { passed: true, failed: [] }), never);
  assert.equal(out.passed, true);
  assert.deepEqual(out.flaky, ['a']);
});

test('named failures twice are regressions unless the baseline fails them too', async () => {
  const twice = () => runs({ passed: false, failed: ['a', 'b'] }, { passed: false, failed: ['a'] });
  const regression = await suiteOutcome(twice(), async () => ({ passed: true, failed: [] }));
  assert.equal(regression.passed, false);
  assert.deepEqual(regression.regressions, ['a']);
  const preexisting = await suiteOutcome(twice(), async () => ({ passed: false, failed: ['a'] }));
  assert.equal(preexisting.passed, true);
  assert.deepEqual(preexisting.baseline_failed, ['a']);
});

test('without test names the baseline decides', async () => {
  const fail = () => runs({ passed: false, failed: [] }, { passed: false, failed: [] });
  assert.equal((await suiteOutcome(fail(), async () => ({ passed: true, failed: [] }))).passed, false);
  assert.equal((await suiteOutcome(fail(), async () => ({ passed: false, failed: [] }))).passed, true);
});

test('a command reports its exit and output', async () => {
  const ok = await runCommand({ command: process.execPath, args: ['-e', 'console.log("hi")'], timeoutMs: 30000 }, process.cwd(), process.env);
  assert.equal(ok.ok, true);
  assert.match(ok.out, /hi/);
  assert.equal((await runCommand({ command: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 30000 }, process.cwd(), process.env)).ok, false);
});
