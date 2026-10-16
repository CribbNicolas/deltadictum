import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pyHidden } from '../../src/eval/bench/projects/ledgerkit/checks.js';

const hasPython = (() => { try { execFileSync('python', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('a hidden unittest module reports each test by name, finds the clone\'s package and leaves nothing behind', { skip: !hasPython }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dd-ledgerkit-hidden-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'ledgerkit'));
  writeFileSync(join(dir, 'ledgerkit', '__init__.py'), 'ONE = 1\n');
  mkdirSync(join(dir, 'tests'));
  writeFileSync(join(dir, 'tests', '__init__.py'), '');
  const out = await pyHidden(dir, { file: 'selftest.py', tests: ['test_passes', 'test_fails', 'test_missing'] });
  assert.deepEqual(out.results, { test_passes: true, test_fails: false, test_missing: false });
  assert.deepEqual(readdirSync(join(dir, 'tests')).sort(), ['__init__.py']);
});
