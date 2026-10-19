// Loaded with --import by every test script.
//
// Session start spawns detached maintenance once a day; in a test it would hold
// files in a temporary project the test is about to delete. Tests of maintenance
// turn it back on for the processes they spawn. Child processes inherit it.
process.env.DD_MAINTENANCE = '0';

// A bench clone's rewritten history is cached (src/eval/bench/history.js); a test's temporary
// repositories build their entries in the system's temporary folder, not in output/eval.
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
process.env.DD_BENCH_HISTORY ??= join(tmpdir(), 'dd-test-bench-history');
