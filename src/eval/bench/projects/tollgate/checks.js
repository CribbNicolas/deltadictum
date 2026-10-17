// tollgate's checks: a hidden Go test run by name in one package.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, changedFiles, exec, withHidden } from '../fixture-checks.js';

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

// The Go a change adds under prefix, its tests left out.
export async function addedCode(dir, prefix) {
  const files = (await changedFiles(dir, prefix)).filter(file => file.endsWith('.go') && !file.endsWith('_test.go'));
  return (await Promise.all(files.map(file => addedLines(dir, file, ['.go'])))).join('\n');
}

// A client that keeps idle connections under 30 seconds: the shared constructor, or an
// IdleConnTimeout of at most 29 s as a field or an assignment; never the default client.
export function idleUnder30s(source) {
  if (/http\.DefaultClient/.test(source)) return false;
  if (/relay\.NewHTTPClient\(/.test(source)) return true;
  const seconds = [...source.matchAll(/IdleConnTimeout\s*[:=]\s*(\d+)\s*\*\s*time\.Second/g)].map(m => Number(m[1]));
  return seconds.length > 0 && seconds.every(s => s <= 29);
}
