// Loaded with --import by every test script.
//
// Session start spawns detached maintenance once a day; in a test it would hold
// files in a temporary project the test is about to delete. Tests of maintenance
// turn it back on for the processes they spawn. Child processes inherit it.
process.env.DD_MAINTENANCE = '0';

// A bench clone's rewritten history is cached (src/eval/bench/history.js); a test's temporary
// repositories build their entries in a folder of the test process, removed when it exits, not in
// output/eval. A process that inherits the folder leaves it to the one that made it.
if (!process.env.DD_BENCH_HISTORY) {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'dd-test-bench-history-'));
  process.env.DD_BENCH_HISTORY = dir;
  process.on('exit', () => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
}
