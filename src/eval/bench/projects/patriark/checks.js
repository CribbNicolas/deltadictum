// Patriark's checks: a hidden xUnit class (with the shared ZzBenchSession helpers) copied into the test
// project for the run of the check only, run by name with dotnet test.
import { copyFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addedLines, exec } from '../fixture-checks.js';

const HIDDEN = join(dirname(fileURLToPath(import.meta.url)), 'hidden');

// dotnet localizes its test results to the machine's language; the checks and the suite parse English.
export const DOTNET_ENV = { DOTNET_CLI_UI_LANGUAGE: 'en', VSLANG: '1033', DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };

export async function dotnetHidden(dir, { file, tests }) {
  const copies = ['ZzBenchSession.cs', file].map(name => [join(HIDDEN, name), join(dir, 'tests', name)]);
  for (const [from, to] of copies) await copyFile(from, to);
  try {
    const run = await exec('dotnet', ['test', 'tests/Patriark.Tests.csproj', '--nologo', '--filter', 'FullyQualifiedName~Patriark.Tests.ZzBench',
      '--logger', 'console;verbosity=normal'], { cwd: dir, timeout: 900000, env: { ...process.env, ...DOTNET_ENV } });
    const text = run.out.replaceAll('\r', '');
    const results = Object.fromEntries(tests.map(name => [name, new RegExp(`^\\s*Passed \\S*\\.${name} \\[`, 'm').test(text)]));
    return { ok: run.ok, results, out: run.out.slice(-3000) };
  } finally {
    for (const [, to] of copies) await rm(to, { force: true });
  }
}

export const addedCs = (dir, prefix) => addedLines(dir, prefix, ['.cs']);
