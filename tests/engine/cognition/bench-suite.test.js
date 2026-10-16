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

test('without test names a baseline that passes makes it a regression', async () => {
  const fail = () => runs({ passed: false, failed: [] }, { passed: false, failed: [] });
  assert.equal((await suiteOutcome(fail(), async () => ({ passed: true, failed: [] }))).passed, false);
});

test('a command reports its exit and output', async () => {
  const ok = await runCommand({ command: process.execPath, args: ['-e', 'console.log("hi")'], timeoutMs: 30000 }, process.cwd(), process.env);
  assert.equal(ok.ok, true);
  assert.match(ok.out, /hi/);
  assert.equal((await runCommand({ command: process.execPath, args: ['-e', 'process.exit(3)'], timeoutMs: 30000 }, process.cwd(), process.env)).ok, false);
});

test('a suite that fails on the baseline too, without test names, is undecided', async () => {
  const out = await suiteOutcome(runs({ passed: false, failed: [] }, { passed: false, failed: [] }), async () => ({ passed: false, failed: [] }));
  assert.equal(out.passed, null);
  assert.equal(out.baseline_passed, false);
});

test('a command\'s output carries its standard error in full', async () => {
  const out = await runCommand({ command: process.execPath, args: ['-e', 'process.stderr.write("x".repeat(6000) + "FAILED test_close")'], timeoutMs: 30000 }, process.cwd(), process.env);
  assert.match(out.out, /FAILED test_close/);
});

test("a suite's own environment is added to the run's (a localized test runner forced to English)", async () => {
  const spec = { command: process.execPath, args: ['-e', 'console.log(process.env.BENCH_LANG, process.env.BENCH_RUN)'], timeoutMs: 30000, env: { BENCH_LANG: 'en' } };
  assert.match((await runCommand(spec, process.cwd(), { ...process.env, BENCH_RUN: 'yes' })).out, /en yes/);
});
