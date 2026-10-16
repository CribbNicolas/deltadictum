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

for (const condition of ['dd2', 'docref', 'doc', 'none']) {
  test(`a ${condition} clone carries its channel only, the stripped rule nowhere, and a clean baseline`, async t => {
    const repo = source(t);
    const { dir, index_memories } = await prepareClone(project(repo), task, condition);
    t.after(() => removeClone(dir, project(repo)));
    const claude = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.doesNotMatch(claude, /Always jitter retries/);
    assert.ok(existsSync(join(dir, 'setup.txt')));
    assert.equal(existsSync(join(dir, '.dd')), condition === 'dd2');
    assert.equal(existsSync(join(dir, 'docs', 'engineering-guide.md')), condition === 'doc' || condition === 'docref');
    assert.equal(/engineering-guide/.test(claude), condition === 'docref');
    assert.equal(index_memories, condition === 'dd2' ? 1 : null);
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
  git(repo, 'checkout', '-q', '-');
  git(repo, 'tag', 'v1');
  const { dir, baseline } = await prepareClone(project(repo), task, 'none');
  t.after(() => removeClone(dir, project(repo)));
  assert.equal(git(dir, 'remote').trim(), '');
  assert.deepEqual(git(dir, 'for-each-ref', '--format=%(refname)').trim().split('\n'), ['refs/heads/main']);
  assert.doesNotMatch(git(dir, 'log', '--all', '--oneline'), /the answer/);
  assert.equal(baseline, git(dir, 'rev-parse', 'HEAD').trim());
});

test('a task\'s setup is its own commit by the project\'s team, so the baseline commit does not show it', async t => {
  const repo = source(t);
  const p = project(repo);
  const { dir } = await prepareClone(p, { ...task, setupMessage: 'Tidy the retry loop' }, 'docref');
  t.after(() => removeClone(dir, p));
  const [baseline, setup] = git(dir, 'log', '-2', '--format=%an|%s').trim().split('\n');
  assert.equal(setup, 'fx team|Tidy the retry loop');
  assert.match(baseline, /^eval\|eval baseline$/);
  const shown = git(dir, 'show', '--name-only', '--format=', 'HEAD');
  assert.doesNotMatch(shown, /setup\.txt/);
  // The stripped rule goes with the setup commit too, not with the baseline.
  assert.doesNotMatch(git(dir, 'show', 'HEAD'), /^-Always jitter retries\.$/m);
});

test('a project\'s prepare step runs in every condition and goes with the setup commit', async t => {
  const repo = source(t);
  const p = { ...project(repo), prepare: async dir => writeFileSync(join(dir, 'CLAUDE.md'), '# Rules\n') };
  const { dir } = await prepareClone(p, { id: 'fx-a' }, 'none');
  t.after(() => removeClone(dir, p));
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), '# Rules\n');
  assert.doesNotMatch(git(dir, 'show', '--name-only', '--format=', 'HEAD'), /CLAUDE\.md/);
});

test('a link that git does not ignore stops the clone', async t => {
  const repo = source(t);
  const p = { ...project(repo), links: ['deps'], link: async dir => { mkdirSync(join(dir, 'deps')); writeFileSync(join(dir, 'deps', 'x'), 'x'); } };
  await assert.rejects(prepareClone(p, task, 'none'), /link_not_ignored: deps/);
});
