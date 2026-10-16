import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
