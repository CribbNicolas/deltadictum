import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture, sourceHash } from '../../src/eval/bench/projects/fixture.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args]).toString().trim();
const hasGo = (() => { try { execFileSync('go', ['version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const hasPython = (() => { try { execFileSync('python', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('the build is deterministic, reused while the source is unchanged, and rebuilt after an interruption', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const a = await buildFixture('tollgate', { out: join(root, 'a') });
  const b = await buildFixture('tollgate', { out: join(root, 'b') });
  assert.equal(a.head, b.head);
  assert.ok(Number(git(a.repo, 'rev-list', '--count', 'HEAD')) >= 30);
  assert.equal(git(a.repo, 'status', '--porcelain'), '');
  assert.equal((await buildFixture('tollgate', { out: join(root, 'a') })).rebuilt, false);
  rmSync(join(root, 'a.hash'));
  writeFileSync(join(root, 'a', 'stray.txt'), 'half-built');
  const again = await buildFixture('tollgate', { out: join(root, 'a') });
  assert.equal(again.rebuilt, true);
  assert.equal(again.head, a.head);
  assert.ok(!existsSync(join(root, 'a', 'stray.txt')));
  assert.match(sourceHash('tollgate'), /^[0-9a-f]{64}$/);
});

test('the built tollgate passes its own suite and vet', { skip: !hasGo }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const { repo } = await buildFixture('tollgate', { out: join(root, 'r') });
  execFileSync('go', ['vet', './...'], { cwd: repo, stdio: 'pipe' });
  execFileSync('go', ['test', './...', '-count=1'], { cwd: repo, stdio: 'pipe' });
  assert.equal(execFileSync('gofmt', ['-l', '.'], { cwd: repo }).toString().trim(), '');
});

test('ledgerkit builds with its CSV fixtures byte for byte and passes its suite in a clone', { skip: !hasPython }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const { repo } = await buildFixture('ledgerkit', { out: join(root, 'r') });
  const clone = join(root, 'clone');
  execFileSync('git', ['clone', '-q', repo, clone]);
  const source = readFileSync(new URL('../../src/eval/bench/projects/ledgerkit/src/testdata/nordbank/2026-01.csv', import.meta.url));
  assert.ok(readFileSync(join(clone, 'testdata', 'nordbank', '2026-01.csv')).equals(source));
  assert.ok(source.includes(Buffer.from('\r\n')) && source.includes(0xf8));
  execFileSync('python', ['-m', 'unittest', 'discover', '-s', 'tests', '-t', '.'], { cwd: clone, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: 'pipe' });
});
