// ledgerkit's checks: a hidden unittest module run by name from the clone's root, so it imports the
// clone's own package; unittest reports on stderr, which exec joins to stdout.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, exec, withHidden } from '../fixture-checks.js';

const HIDDEN = join(dirname(fileURLToPath(import.meta.url)), 'hidden');
export const PYTHON_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' };

// The named tests of one test module of the clone (tests.<module>).
export async function pyTests(dir, { module, tests }) {
  // -b buffers what the code under test writes, which would otherwise land between "... " and "ok".
  const run = await exec('python', ['-m', 'unittest', `tests.${module}`, '-v', '-b'], { cwd: dir, env: PYTHON_ENV });
  const text = run.out.replaceAll('\r', '');
  const results = Object.fromEntries(tests.map(name => [name, new RegExp(`^${name} \\(.*\\) \\.\\.\\. ok$`, 'm').test(text)]));
  return { ok: run.ok, results, out: run.out.slice(-3000) };
}

export async function pyHidden(dir, { file, tests }) {
  const module = `zz_bench_${file.replace(/\.py$/, '')}`;
  return withHidden(join(HIDDEN, file), join(dir, 'tests', `${module}.py`), () => pyTests(dir, { module, tests }));
}

export const addedPy = (dir, prefix) => addedLines(dir, prefix, ['.py']);

// A line that opens a file for writing, appending or creating, nested parentheses in the path included.
export const truncatingOpen = text => String(text).split('\n').some(line => /\bopen\(.*['"][wax]b?\+?['"]/.test(line));
