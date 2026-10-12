import { evaluateCommand, evaluateContent, exampleProblems } from '../../checks/check.cjs';
import { createMatcher, unsafePattern } from '../../checks/pattern.cjs';
import { globToRegExp } from '../../engine/clause.cjs';

export { unsafePattern };

// The production check module (src/checks/check.cjs), with one bounded matcher.
const matcher = createMatcher();

// A violation: if_content matches and unless_content, when stated, does not.
export const violates = (check, text) => evaluateContent(check, text, matcher).violated;

// Whether a check behaves as its own examples say.
export const examplesHold = check => !exampleProblems(check, matcher).length;

// A check scored on the lines each run added to the files it covers, against the
// run's verdict on the requirement it enforces (true: met, so silence is right).
// Added lines stand in for the file after the change: the trial kept diffs, not files.
export function scoreCheck(spec, fixture) {
  const counts = { tp: 0, fp: 0, fn: 0, tn: 0, fired: 0, runs_seen: 0 };
  const cases = [];
  for (const run of fixture.runs) {
    const files = Object.entries(run.added ?? {}).filter(([path]) => spec.check.paths.some(glob => globToRegExp(glob).test(path)));
    if (!files.length) continue;
    counts.runs_seen += 1;
    const fired = files.some(([, text]) => violates(spec.check, text));
    if (fired) counts.fired += 1;
    const verdict = spec.requirement ? run.verdicts?.[spec.requirement] : undefined;
    if (typeof verdict !== 'boolean') continue;
    const outcome = fired ? (verdict ? 'fp' : 'tp') : (verdict ? 'tn' : 'fn');
    counts[outcome] += 1;
    if (outcome === 'fp' || outcome === 'fn') cases.push({ run_id: run.run_id, outcome });
  }
  return { memory: spec.memory, requirement: spec.requirement ?? null, engine: 'production', examples_hold: examplesHold(spec.check),
    unsafe: unsafePattern(spec.check.if_content) || Boolean(spec.check.unless_content && unsafePattern(spec.check.unless_content)), ...counts, cases };
}

// A command check scored on every run's commands: how often it would speak.
export function scoreCommandCheck(spec, fixture) {
  const runs = fixture.runs.filter(run => run.events.some(e => e.kind === 'run' && evaluateCommand(spec.check, e.text ?? '', matcher).violated))
    .map(run => run.run_id);
  return { memory: spec.memory, fired: runs.length, runs: runs.slice(0, 10) };
}
