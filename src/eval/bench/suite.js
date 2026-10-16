// The project's own suite on the changed tree, as CI would run it, on any stack.
// A failure runs once more, and a failure twice is compared with the tree
// without the change: only what the change broke counts against the agent.
import { run } from '../agent/proc.js';

export async function runCommand(spec, cwd, env) {
  const out = await run(spec.command, spec.args, { cwd, env, shell: Boolean(spec.shell), timeout: spec.timeoutMs })
    .catch(err => ({ code: 1, out: err.message, timedOut: false }));
  return { ok: out.code === 0 && !out.timedOut, out: String(out.out ?? '') };
}

export async function suiteOutcome(runSuite, runBaseline, knownFlaky = []) {
  const flakyOnly = s => s.failed.length > 0 && s.failed.every(name => knownFlaky.includes(name));
  const outcome = over => ({ passed: true, first_passed: false, failed_twice: [], regressions: [], baseline_failed: null, flaky: [], ...over });
  const first = await runSuite();
  if (first.passed || flakyOnly(first)) return outcome({ first_passed: first.passed });
  const second = await runSuite();
  if (second.passed || flakyOnly(second)) return outcome({ flaky: first.failed.filter(name => !second.failed.includes(name)) });
  const failedTwice = second.failed.filter(name => first.failed.includes(name) && !knownFlaky.includes(name));
  const baseline = await runBaseline();
  // Without test names, the baseline failing as well is the only way to tell the machine from the change.
  if (!second.failed.length) return outcome({ passed: !baseline.passed, baseline_failed: baseline.failed });
  const regressions = failedTwice.filter(name => !baseline.failed.includes(name));
  return outcome({ passed: failedTwice.length > 0 && !regressions.length, failed_twice: failedTwice, regressions, baseline_failed: baseline.failed });
}
