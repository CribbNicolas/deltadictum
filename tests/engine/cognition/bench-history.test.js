import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanHistory } from '../../../src/eval/bench/history.js';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-history-'));
  const repo = join(root, 'src repo');
  mkdirSync(join(repo, '.dd', 'memories'), { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  writeFileSync(join(repo, '.dd', 'memories', 'x.json'), '{"title":"secret knowledge"}\n');
  writeFileSync(join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'one');
  writeFileSync(join(repo, '.dd', 'memories', 'x.json'), '{"title":"secret knowledge, revised"}\n');
  writeFileSync(join(repo, 'a.txt'), 'two\n');
  git(repo, 'commit', '-q', '-am', 'two');
  writeFileSync(join(repo, 'a.txt'), 'three\n');
  git(repo, 'commit', '-q', '-am', 'three');
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { repo, cacheDir: join(root, 'cache') };
}
const tree = (dir, commit) => git(dir, 'ls-tree', '-r', commit).split('\n').filter(Boolean)
  .map(line => line.split('\t')[1]).filter(path => !path.startsWith('.dd/')).sort();

test('the rewritten history names no stripped path in any commit', async t => {
  const { repo, cacheDir } = fixture(t);
  const out = await cleanHistory({ repo, base: 'main', cacheDir });
  const names = git(out.repo, 'log', '--all', '--name-only', '--format=');
  assert.doesNotMatch(names, /\.dd\//);
  assert.match(names, /a\.txt/);
  assert.equal(git(out.repo, 'rev-list', '--count', out.commit).trim(), '3');
  assert.doesNotMatch(git(out.repo, 'log', '--all', '-p'), /secret knowledge/);
});

test('the rewritten base has the same tree minus the stripped paths', async t => {
  const { repo, cacheDir } = fixture(t);
  const out = await cleanHistory({ repo, base: 'main', cacheDir });
  assert.deepEqual(tree(out.repo, out.commit), tree(repo, 'main'));
  assert.deepEqual(git(out.repo, 'ls-tree', '-r', '--name-only', out.commit).trim().split('\n'), ['a.txt']);
});

test('a second call reuses the entry', async t => {
  const { repo, cacheDir } = fixture(t);
  const first = await cleanHistory({ repo, base: 'main', cacheDir });
  const before = statSync(first.repo).mtimeMs;
  const second = await cleanHistory({ repo, base: 'main', cacheDir });
  assert.deepEqual(second, first);
  assert.equal(statSync(second.repo).mtimeMs, before);
});

test('two calls at once give one entry', async t => {
  const { repo, cacheDir } = fixture(t);
  const [a, b] = await Promise.all([cleanHistory({ repo, base: 'main', cacheDir }), cleanHistory({ repo, base: 'main', cacheDir })]);
  assert.deepEqual(a, b);
  assert.deepEqual(execFileSync('git', ['-C', a.repo, 'rev-parse', 'HEAD']).toString().trim(), a.commit);
});

test('another strip list or base builds another entry', async t => {
  const { repo, cacheDir } = fixture(t);
  const clean = await cleanHistory({ repo, base: 'main', cacheDir });
  const kept = await cleanHistory({ repo, base: 'main', strip: [], cacheDir });
  assert.notEqual(kept.repo, clean.repo);
  assert.match(git(kept.repo, 'log', '--all', '--name-only', '--format='), /\.dd\/memories\/x\.json/);
  const older = await cleanHistory({ repo, base: 'main~1', cacheDir });
  assert.notEqual(older.repo, clean.repo);
  assert.equal(git(older.repo, 'rev-list', '--count', older.commit).trim(), '2');
});

test('no ref but the branch survives', async t => {
  const { repo, cacheDir } = fixture(t);
  const out = await cleanHistory({ repo, base: 'main', cacheDir });
  assert.deepEqual(git(out.repo, 'for-each-ref', '--format=%(refname)').trim().split('\n'), ['refs/heads/main']);
  // The original commits are gone from the object store too, not only unreferenced.
  assert.throws(() => git(out.repo, 'cat-file', '-e', `${git(repo, 'rev-parse', 'main').trim()}^{commit}`));
});

test('a build leaves the event loop free for the other workers', async t => {
  const { repo, cacheDir } = fixture(t);
  let last = performance.now(), longest = 0;
  const timer = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 5);
  const started = performance.now();
  await cleanHistory({ repo, base: 'main', cacheDir });
  const took = performance.now() - started;
  clearInterval(timer);
  assert.ok(longest < Math.max(400, took / 3), `the loop stalled ${Math.round(longest)} ms of a ${Math.round(took)} ms build`);
});

test('a commit that touched only the stripped paths is gone, with its message', async t => {
  const { repo, cacheDir } = fixture(t);
  writeFileSync(join(repo, '.dd', 'memories', 'x.json'), '{"title":"third revision"}\n');
  git(repo, 'commit', '-q', '-am', 'store: the retry window is 72 hours');
  const out = await cleanHistory({ repo, base: 'main', cacheDir });
  assert.equal(git(out.repo, 'rev-list', '--count', out.commit).trim(), '3');
  assert.doesNotMatch(git(out.repo, 'log', '--format=%B', out.commit), /retry window/);
});

test('a test process caches histories in its own folder, removed when it exits', t => {
  const helper = join(process.cwd(), 'tests', 'helpers', 'isolate-data.js');
  const script = "const d = process.env.DD_BENCH_HISTORY; require('node:fs').mkdirSync(require('node:path').join(d, 'x.git'), { recursive: true }); console.log(d);";
  const env = { ...process.env };
  delete env.DD_BENCH_HISTORY;
  const dir = execFileSync(process.execPath, ['--import', pathToFileURL(helper).href, '-e', script], { env }).toString().trim();
  assert.ok(dir.startsWith(tmpdir()), dir);
  assert.ok(!existsSync(dir), `${dir} is removed`);
  // A process that inherits the folder leaves it to its parent.
  const inherited = mkdtempSync(join(tmpdir(), 'dd-inherited-'));
  t.after?.(() => rmSync(inherited, { recursive: true, force: true }));
  execFileSync(process.execPath, ['--import', pathToFileURL(helper).href, '-e', script], { env: { ...env, DD_BENCH_HISTORY: inherited } });
  assert.ok(existsSync(join(inherited, 'x.git')));
  rmSync(inherited, { recursive: true, force: true });
});
