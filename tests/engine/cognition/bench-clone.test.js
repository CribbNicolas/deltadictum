import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareClone, removeClone } from '../../../src/eval/bench/clone.js';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString();
function source(t) {
  const repo = mkdtempSync(join(tmpdir(), 'dd-bench-src-'));
  git(repo, 'init', '-q');
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Rules\n\nAlways jitter retries.\nKeep it small.\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  t.after(() => rmSync(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return repo;
}
const memory = { topic: 'net/retry', kind: 'trap', title: 'Retry jitter', body: 'Always jitter retries.', not_derivable: 'Partner rate limits.',
  triggers: [{ on: ['read'], paths: ['README.md'] }], evidence: [{ path: 'README.md', summary: 'Readme.' }] };
const project = repo => ({ id: 'fx', repo, base: 'HEAD', store: 'bench', guideTarget: 'CLAUDE.md', memories: [memory], links: [],
  strip: [{ file: 'CLAUDE.md', line: 'Always jitter retries.' }] });
const task = { id: 'fx-a', setup: async dir => writeFileSync(join(dir, 'setup.txt'), 'x') };

for (const condition of ['dd2', 'docref', 'doc', 'none', 'docdd']) {
  test(`a ${condition} clone carries its channel only, the stripped rule nowhere, and a clean baseline`, async t => {
    const repo = source(t);
    const { dir, index_memories } = await prepareClone(project(repo), task, condition);
    t.after(() => removeClone(dir, project(repo)));
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claude, /Always jitter retries/);
    assert.ok(existsSync(join(dir, 'setup.txt')));
    const store = ['dd2', 'docdd'].includes(condition);
    assert.equal(existsSync(join(dir, '.dd')), store);
    assert.equal(existsSync(join(dir, 'docs', 'engineering-guide.md')), ['doc', 'docref', 'docdd'].includes(condition));
    assert.equal(/engineering-guide/.test(claude), ['docref', 'docdd'].includes(condition));
    assert.equal(index_memories, store ? 1 : null);
    assert.equal(git(dir, 'status', '--porcelain').trim(), '');
  });
}

test('a strip line that is not in the file stops the clone', async t => {
  const repo = source(t);
  const p = { ...project(repo), strip: [{ file: 'CLAUDE.md', line: 'Not there.' }] };
  await assert.rejects(prepareClone(p, task, 'none'), /strip_not_found: CLAUDE.md: Not there\./);
});

test('a clone has no remote and no ref but its own branch, so the source repository and other branches are out of reach', async t => {
  const repo = source(t);
  git(repo, 'checkout', '-q', '-b', 'answers');
  writeFileSync(join(repo, 'answer.txt'), 'secret\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'the answer');
  const answer = git(repo, 'rev-parse', 'HEAD').trim();
  git(repo, 'checkout', '-q', '-');
  git(repo, 'tag', 'v1');
  const { dir, baseline } = await prepareClone(project(repo), task, 'none');
  t.after(() => removeClone(dir, project(repo)));
  assert.equal(git(dir, 'remote').trim(), '');
  assert.deepEqual(git(dir, 'for-each-ref', '--format=%(refname)').trim().split('\n'), ['refs/heads/main']);
  assert.doesNotMatch(git(dir, 'log', '--all', '--oneline'), /the answer/);
  assert.equal(baseline, git(dir, 'rev-parse', 'HEAD').trim());
  // Not even as an object: the clone holds what the base reaches and nothing else.
  assert.throws(() => git(dir, 'cat-file', '-e', answer), undefined, 'the answer commit is in the clone');
});

for (const condition of ['dd2', 'docref', 'doc', 'none', 'docdd']) {
  test(`a task's setup is the last commit, by the project's team, in a ${condition} clone too`, async t => {
    const repo = source(t);
    const p = project(repo);
    const { dir, baseline } = await prepareClone(p, { ...task, setupMessage: 'Tidy the retry loop' }, condition);
    t.after(() => removeClone(dir, p));
    assert.equal(baseline, git(dir, 'rev-parse', 'HEAD').trim());
    const [setup, before] = git(dir, 'log', '-2', '--format=%an|%s').trim().split('\n');
    assert.equal(setup, 'fx team|Tidy the retry loop');
    assert.equal(before, 'fx team|Update');
    // "The last commit" a prompt names is the teammate's change alone: the condition's files and the
    // stripped rule went into the commit before it.
    assert.equal(git(dir, 'show', '--name-only', '--format=', 'HEAD').trim(), 'setup.txt');
    assert.match(git(dir, 'show', 'HEAD~1'), /^-Always jitter retries\.$/m);
  });
}

test('a project\'s prepare step runs in every condition and goes before the setup commit', async t => {
  const repo = source(t);
  const p = { ...project(repo), prepare: async dir => writeFileSync(join(dir, 'CLAUDE.md'), '# Rules\n') };
  const { dir } = await prepareClone(p, task, 'none');
  t.after(() => removeClone(dir, p));
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Rules\n');
  assert.doesNotMatch(git(dir, 'show', '--name-only', '--format=', 'HEAD'), /CLAUDE\.md/);
});

test('a link that git does not ignore stops the clone', async t => {
  const repo = source(t);
  const p = { ...project(repo), links: ['deps'], link: async dir => { mkdirSync(join(dir, 'deps')); writeFileSync(join(dir, 'deps', 'x'), 'x'); } };
  await assert.rejects(prepareClone(p, task, 'none'), /link_not_ignored: deps/);
});

// A source whose history and base tree hold DD's store, as supermem's and Patriark's do.
function storeSource(t) {
  const repo = source(t);
  mkdirSync(join(repo, '.dd', 'memories'), { recursive: true });
  writeFileSync(join(repo, '.dd', 'memories', 'own.json'), '{"title":"the project\'s own memory"}\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'store');
  writeFileSync(join(repo, 'README.md'), '# Fixture, later\n');
  git(repo, 'commit', '-q', '-am', 'later');
  return repo;
}

test('no condition\'s clone history names .dd/', async t => {
  const repo = storeSource(t);
  for (const condition of ['none', 'doc', 'docref', 'dd2', 'docdd']) {
    const { dir } = await prepareClone(project(repo), task, condition);
    t.after(() => removeClone(dir, project(repo)));
    // HEAD is the task's setup, HEAD~1 the team's "Update" (where dd2 adds its store), HEAD~2 the base.
    assert.doesNotMatch(git(dir, 'log', '--name-only', '--format=', 'HEAD~2'), /\.dd\//, condition);
    assert.doesNotMatch(git(dir, 'log', '-p', 'HEAD~2'), /own memory/, condition);
    if (condition === 'dd2' || condition === 'docdd') assert.ok(existsSync(join(dir, '.dd', 'memories')));
  }
});

test('every condition starts from the same base commit', async t => {
  const repo = storeSource(t);
  const bases = new Set();
  for (const condition of ['none', 'doc', 'docref', 'dd2', 'docdd']) {
    const { dir } = await prepareClone(project(repo), task, condition);
    t.after(() => removeClone(dir, project(repo)));
    bases.add(git(dir, 'rev-parse', 'HEAD~2').trim());
  }
  assert.equal(bases.size, 1);
});

test('a project that keeps its own store gets it back in the DD conditions only, from the base tree', async t => {
  const repo = storeSource(t);
  const existing = { ...project(repo), store: 'existing', memories: [] };
  const { dir } = await prepareClone(existing, task, 'dd2');
  t.after(() => removeClone(dir, existing));
  assert.equal(readFileSync(join(dir, '.dd', 'memories', 'own.json'), 'utf8'), '{"title":"the project\'s own memory"}\n');
  assert.doesNotMatch(git(dir, 'log', '--name-only', '--format=', 'HEAD~2'), /\.dd\//);
  const { dir: both } = await prepareClone(existing, task, 'docdd');
  t.after(() => removeClone(both, existing));
  assert.ok(existsSync(join(both, '.dd', 'memories', 'own.json')));
  const { dir: none } = await prepareClone(existing, task, 'none');
  t.after(() => removeClone(none, existing));
  assert.ok(!existsSync(join(none, '.dd')));
});
