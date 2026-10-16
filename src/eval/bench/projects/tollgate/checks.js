// tollgate's checks: a hidden Go test run by name in one package.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, exec, withHidden } from '../fixture-checks.js';

const HIDDEN = join(dirname(fileURLToPath(import.meta.url)), 'hidden');

// The named tests of one package, as the clone has them.
export async function goTests(dir, { pkg, tests }) {
  const run = await exec('go', ['test', `./${pkg}`, '-count=1', '-v', '-run', `^(${tests.join('|')})$`], { cwd: dir });
  const text = run.out.replaceAll('\r', '');
  const results = Object.fromEntries(tests.map(name => [name, new RegExp(`^\\s*--- PASS: ${name}\\b`, 'm').test(text)]));
  return { ok: run.ok, results, out: run.out.slice(-3000) };
}

// A package the change was to create and did not: every test fails.
export async function goHidden(dir, { pkg, file, tests }) {
  const folder = join(dir, ...pkg.split('/'));
  if (!existsSync(folder)) return { ok: false, results: Object.fromEntries(tests.map(name => [name, false])), out: `no package ${pkg}` };
  return withHidden(join(HIDDEN, file), join(folder, `zz_bench_${basename(file)}`), () => goTests(dir, { pkg, tests }));
}

export const addedGo = (dir, prefix) => addedLines(dir, prefix, ['.go']);
