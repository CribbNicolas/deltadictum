// The project's own suite on the changed tree, as CI would run it, on any stack.
// A failure runs once more, and a failure twice is compared with the tree
// without the change: only what the change broke counts against the agent.
import { run } from '../agent/proc.js';

export async function runCommand(spec, cwd, env) {
  // A project's own variables (a test runner forced to English for its parser) go on top of the run's.
  if (spec.env) env = { ...(env ?? process.env), ...spec.env };
  const out = await run(spec.command, spec.args, { cwd, env, shell: Boolean(spec.shell), timeout: spec.timeoutMs, errLimit: 4 * 1024 * 1024 })
    .catch(err => ({ code: 1, out: '', err: err.message, timedOut: false }));
  // Test runners report on either stream: python -m unittest writes its results to stderr.
  return { ok: out.code === 0 && !out.timedOut, out: `${out.out ?? ''}
${out.err ?? ''}` };
}

// A row's suite verdict judged again from what it recorded, when a test is found flaky after the run:
// the fields that change, or nothing.
export function suiteReverdict(row, knownFlaky = []) {
  const twice = row.suite_failed_twice ?? [];
  const flaky = twice.filter(name => knownFlaky.includes(name));
  if (!flaky.length) return {};
  const failedTwice = twice.filter(name => !flaky.includes(name));
  const regressions = (row.suite_regressions ?? []).filter(name => !flaky.includes(name));
  return { suite_passed: !failedTwice.length || !regressions.length, suite_failed_twice: failedTwice, suite_regressions: regressions,
    suite_flaky: [...new Set([...(row.suite_flaky ?? []), ...flaky])] };
}

export async function suiteOutcome(runSuite, runBaseline, knownFlaky = []) {
  const flakyOnly = s => s.failed.length > 0 && s.failed.every(name => knownFlaky.includes(name));
  const outcome = over => ({ passed: true, first_passed: false, failed_twice: [], regressions: [], baseline_failed: null, baseline_passed: null, flaky: [], ...over });
  const first = await runSuite();
  if (first.passed || flakyOnly(first)) return outcome({ first_passed: first.passed });
  const second = await runSuite();
  if (second.passed || flakyOnly(second)) return outcome({ flaky: first.failed.filter(name => !second.failed.includes(name)) });
  // A first run that named no test (a crash) leaves the second run's failures as the ones seen twice.
  const failedTwice = (first.failed.length ? second.failed.filter(name => first.failed.includes(name)) : second.failed)
    .filter(name => !knownFlaky.includes(name));
  // Two runs failing different tests: none failed twice, which is flakiness, not the change.
  if (second.failed.length && !failedTwice.length) return outcome({ flaky: [...new Set([...first.failed, ...second.failed])] });
  const baseline = await runBaseline();
  // Without test names a baseline that passes makes it a regression; one that fails as well leaves it
  // undecided (null): the suite cannot run here, which is the harness's fault, not the agent's.
  if (!second.failed.length) return outcome({ passed: baseline.passed ? false : null, baseline_failed: baseline.failed, baseline_passed: baseline.passed });
  const regressions = failedTwice.filter(name => !baseline.failed.includes(name));
  return outcome({ passed: !regressions.length, failed_twice: failedTwice, regressions, baseline_failed: baseline.failed, baseline_passed: baseline.passed });
}
