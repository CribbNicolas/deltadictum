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
