// tollgate's checks: a hidden Go test run by name in one package.
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, exec, withHidden } from '../fixture-checks.js';

const HIDDEN = join(dirname(fileURLToPath(import.meta.url)), 'hidden');

export async function goHidden(dir, { pkg, file, tests }) {
  return withHidden(join(HIDDEN, file), join(dir, ...pkg.split('/'), `zz_bench_${basename(file)}`), async () => {
    const run = await exec('go', ['test', `./${pkg}`, '-count=1', '-v', '-run', `^(${tests.join('|')})$`], { cwd: dir });
    const text = run.out.replaceAll('\r', '');
    const results = Object.fromEntries(tests.map(name => [name, new RegExp(`^\\s*--- PASS: ${name}\\b`, 'm').test(text)]));
    return { ok: run.ok, results, out: run.out.slice(-3000) };
  });
}

export const addedGo = (dir, prefix) => addedLines(dir, prefix, ['.go']);
