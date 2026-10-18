import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { goHidden } from '../../src/eval/bench/projects/tollgate/checks.js';

const hasGo = (() => { try { execFileSync('go', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a hidden test reports each test by name and leaves nothing behind', { skip: !hasGo }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-tollgate-hidden-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'go.mod'), 'module x\n\ngo 1.22\n');
  mkdirSync(join(dir, 'p'));
  writeFileSync(join(dir, 'p', 'p.go'), 'package p\n\nfunc One() int { return 1 }\n');
  const out = await goHidden(dir, { pkg: 'p', file: 'selftest_test.go', tests: ['TestBenchPasses', 'TestBenchFails', 'TestBenchMissing'] });
  assert.deepEqual(out.results, { TestBenchPasses: true, TestBenchFails: false, TestBenchMissing: false });
  assert.deepEqual(readdirSync(join(dir, 'p')), ['p.go']);
});

// A package that does not build names no test: without its own name, one differently named flaky failure
// in each suite run would hide it (the suite's verdict compares names).
test('the suite parser names a package that failed to build, beside the tests that failed', async () => {
  const { default: tollgate } = await import('../../src/eval/bench/projects/tollgate.js');
  const out = '--- FAIL: TestRetry (0.01s)\nFAIL\ttollgate/internal/relay [build failed]\nFAIL tollgate/internal/store [setup failed]\nok  \ttollgate/internal/sign\t0.2s\n';
  assert.deepEqual(tollgate.parseFailures(out), ['TestRetry', 'tollgate/internal/relay [build failed]', 'tollgate/internal/store [setup failed]']);
});
