// supermem's mined tasks (docs/superpowers/plans/2026-10-16-bench-04-supermem.md): each starts at a v2 fix
// commit's parent, and the test the fix added decides it. The check copies the fix's version of the test
// file beside the original (zz_bench_<name>, so its relative imports resolve) and runs it; a deciding test
// passes when the spec reporter prints it with a check mark.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detail, exec, withHidden } from '../fixture-checks.js';

const REPO = resolve(fileURLToPath(new URL('../../../../..', import.meta.url)));
const HIDDEN = join(dirname(fileURLToPath(import.meta.url)), 'hidden');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The fix's test file, kept beside this module so a check never depends on the repository's refs.
function hiddenCopy(fix, test) {
  const file = join(HIDDEN, `${fix}-${basename(test)}`);
  if (!existsSync(file)) writeFileSync(file, execFileSync('git', ['-C', REPO, 'show', `${fix}:${test}`]));
  return file;
}

async function runFixTest(dir, { fix, test, names, tries = 1, timeout = 300000 }) {
  const target = join(dir, dirname(test), `zz_bench_${basename(test)}`);
  const isolate = existsSync(join(dir, 'tests', 'helpers', 'isolate-data.js')) ? ['--import', './tests/helpers/isolate-data.js'] : [];
  const args = [...isolate, '--test', '--test-reporter=spec', `--test-name-pattern=^(${names.map(escape).join('|')})$`, target.slice(dir.length + 1).replaceAll('\\', '/')];
  return withHidden(hiddenCopy(fix, test), target, async () => {
    let results = Object.fromEntries(names.map(name => [name, false])), out = '';
    for (let i = 0; i < tries && !Object.values(results).every(Boolean); i += 1) {
      // Without NODE_TEST_CONTEXT: a check run from inside node --test would make the child skip its files.
      const { NODE_TEST_CONTEXT, ...env } = process.env;
      const run = await exec(process.execPath, args, { cwd: dir, timeout, env: { ...env, DD_MAINTENANCE: '0' } });
      out = run.out;
      const text = out.replaceAll('\r', '');
      results = Object.fromEntries(names.map(name => [name, results[name] || new RegExp(`^\\s*✔ ${escape(name)} \\(`, 'm').test(text)]));
    }
    return { results, out };
  });
}

const mined = ({ id, situation, fix, parent, memory, prompt, test, names, tries, timeout }) => ({
  id: `supermem-${id}`, project: 'supermem', situation, origin: 'mined', kind: 'memory', memories: [memory], base: parent, source: fix, prompt,
  requirements: [{ id: 'fix_test', auto: true, text: `The fix's own test passes: ${names.join('; ')}.` }],
  async check(dir) {
    const run = await runFixTest(dir, { fix, test, names, tries, timeout });
    const passed = Object.values(run.results).every(Boolean);
    return { passed, requirements: { fix_test: passed }, detail: detail({ ...run.results, ...(passed ? {} : { output: run.out.slice(-500).replace(/\s+/g, ' ') }) }) };
  },
});

export const MINED_TASKS = [
  mined({ id: 'crlf-edit-check', situation: 'S3', fix: '38d51e8', parent: '917d883', memory: 'checks/crlf-edit-match',
    test: 'tests/hooks/v2-checks.test.js', names: ['an edit check judges a multi-line Edit on a CRLF file'],
    prompt: 'An edit check never fires for multi-line Edits on my Windows laptop, although the same check fires on CI. Make it fire.' }),
  mined({ id: 'run-is-not-edit', situation: 'S15', fix: 'ef1ea3e', parent: 'e2ae968', memory: 'checks/run-is-not-edit',
    test: 'tests/capture/turn-checks.test.js', names: ['a turn that only runs a command naming a reported file leaves it alone'],
    prompt: 'After a check flagged a file, I only ran that file\'s test, and at Stop DD reported the violation again as if I had edited the file. Running a file must not count as changing it.' }),
  mined({ id: 'pattern-empty-class', situation: 'S1', fix: 'f955e00', parent: '38d51e8', memory: 'checks/js-regex-empty-class',
    test: 'tests/engine/v2/check-pattern.test.js', names: ['quantified groups that hold a quantifier or an alternation, and backreferences, are refused'],
    prompt: 'The check pattern guard accepts `[]|(a+)+$|]` and `[^](a+)+`, which can backtrack catastrophically. Make the guard refuse them, like the other nested quantifiers it already refuses.' }),
  mined({ id: 'glob-star-chain', situation: 'S2', fix: '7160d15', parent: '05c6d71', memory: 'engine/glob-star-chains', timeout: 60000,
    test: 'tests/engine/v2/clause.test.js', names: ['chained ** segments match as one and stay fast on a path they miss'],
    prompt: 'A memory with a long path glob made every tool call take minutes in one project. Find out why and make it stop.' }),
  mined({ id: 'telemetry-locked', situation: 'S2', fix: 'eef1127', parent: '40e16fe', memory: 'maintenance/telemetry-busy-timeout', tries: 3,
    test: 'tests/maintenance/telemetry.test.js', names: ['a write waits for another process holding the telemetry lock instead of failing'],
    prompt: 'The review UI sometimes fails with "database is locked" while the daily maintenance run is going. Make that stop.' }),
  mined({ id: 'session-cwd', situation: 'S3', fix: '3bdb8bd', parent: 'f070b60', memory: 'hooks/session-cwd',
    test: 'tests/hooks/v2-events.test.js', names: ['relative paths in a command, a search or a read are resolved from the session folder'],
    prompt: 'I started the agent in `packages/api` of a monorepo, and DD never delivers that folder\'s memories: the relative paths in my commands, searches and reads are taken from the repository root, not from the folder the session runs in. Fix it. `toolEvent(name, input, root, cwd)` and `bashPaths(command, root, cwd)` should take the session folder as an optional last argument; without it, paths resolve from the root as they do now.' }),
  mined({ id: 'rename-retry', situation: 'S17', fix: 'd1c4803', parent: '7fa5e99', memory: 'engine/windows-rename-retry',
    test: 'tests/engine/v2/compile.test.js', names: ['a rename the system refuses for a moment is retried, and a lasting refusal leaves no temp file'],
    prompt: 'On Windows, writing the compiled index sometimes dies with EPERM while a hook is reading it. Make the write robust; let `writeCompiled(paths, compiled, { rename })` take the rename function as an option, defaulting to the real one, so a test can stand in for the system.' }),
  mined({ id: 'dead-symbol', situation: 'S15', fix: '45a2c3e', parent: '19914e7', memory: 'engine/dead-symbol-search',
    test: 'tests/engine/v2/compile.test.js', names: ['a symbol found only in DD files is dead; one in the code is not, however many there are'],
    prompt: 'DD never reports a trigger symbol as dead, even for a function I deleted last month. Find out why and fix it.' }),
  mined({ id: 'skills-npx', situation: 'S3', fix: 'c29ff9b', parent: 'b3820e3', memory: 'skills/plugin-root-cli',
    test: 'tests/skills/skills.test.js', names: [],
    prompt: '/dd:recall is slow in a marketplace install and sometimes shows results from another version of DD. The machine has no deltadictum on PATH. Fix the recall and review skills.' }),
  mined({ id: 'claim-delivered', situation: 'S5', fix: '19914e7', parent: 'd1c4803', memory: 'delivery/claim-only-delivered',
    test: 'tests/hooks/v2-hook.test.js', names: ['memories that did not fit are named, not marked delivered, and arrive in full next time'],
    prompt: 'A long memory is announced as "... and N more" but never arrives in full, not even at later tool calls. Make sure every memory that fires eventually arrives whole.' }),
  mined({ id: 'subfolder-committed', situation: 'S3', fix: '56115e3', parent: 'e6ebf95', memory: 'checks/git-show-relative',
    test: 'tests/capture/turn-checks.test.js', names: ['a violation already committed is left alone also when the project is a subfolder of the repository'],
    prompt: 'In a project that is a subfolder of its git repository, a violation that was already in the last commit is still reported at Stop as caused by my turn.' }),
  mined({ id: 'symbols-not-prompts', situation: 'S4', fix: 'bd0b079', parent: 'a8b4a82', memory: 'engine/symbols-not-prompts',
    test: 'tests/engine/v2/clause.test.js', names: ['symbols are never matched against a prompt: the signal is what the agent does'],
    prompt: 'A memory about `retryFetch` fires as soon as I mention retryFetch in a prompt, before anyone touches the code. Fix it.' }),
  mined({ id: 'inbox-ignored', situation: 'S5', fix: '06b61fc', parent: 'b06c56f', memory: 'capture/inbox-ignore-first',
    test: 'tests/capture/inbox.test.js', names: ['the first ingestion keeps the inbox out of git, even when it rejects'],
    prompt: 'In a new project, rejected proposals in `.dd/inbox` show up as untracked files in git status after my first /dd:save, which was rejected.' }),
];

// c29ff9b's own test demands one exact quoting; the check reads the skills instead.
{
  const task = MINED_TASKS.find(t => t.id === 'supermem-skills-npx');
  task.requirements = [{ id: 'plugin_root_cli', auto: true, text: 'The recall and review skills run node on ${CLAUDE_PLUGIN_ROOT}/src/cli.js and never npx.' }];
  task.check = async dir => {
    const skill = name => { try { return readFileSync(join(dir, 'skills', name, 'SKILL.md'), 'utf8'); } catch { return ''; } };
    // npx only counts in what the skill runs: anywhere in a fenced block, and in inline code unless the
    // words just before it on its line forbid it ("Do not run `npx deltadictum`", as the calibration's
    // runs wrote); "instead of" or "rather than" offer it, they do not forbid it.
    const FENCE = /```[^\n]*\n([\s\S]*?)```/g;
    const FORBIDDEN = /\b(?:do not|don['’]t|never|avoid)\s+(?:[\w-]+\s+){0,2}$/i;
    const runsNpx = text => {
      const prose = text.replace(/\r/g, '').replace(FENCE, '\n');
      return [...text.matchAll(FENCE)].some(m => /\bnpx\b/.test(m[1]))
        || prose.split('\n').some(line => [...line.matchAll(/`([^`]+)`/g)]
          .some(m => /\bnpx\b/.test(m[1]) && !FORBIDDEN.test(line.slice(0, m.index))));
    };
    const ok = ['recall', 'review'].every(name => /node\s+"?\$\{?CLAUDE_PLUGIN_ROOT\}?\/src\/cli\.js"?/.test(skill(name)) && !runsNpx(skill(name)));
    return { passed: ok, requirements: { plugin_root_cli: ok }, detail: detail({ 'skills run the plugin CLI': ok }) };
  };
}
