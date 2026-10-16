import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString();

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-bench-run-'));
  const repo = join(root, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  writeFileSync(join(repo, 'README.md'), '# Fixture\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  const registry = join(root, 'registry.mjs');
  writeFileSync(registry, `import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
const memory = { topic: 'fx/answer', kind: 'decision', title: 'Answers go in answer.txt', body: 'Write answers to answer.txt.', not_derivable: 'Invented.',
  triggers: [{ on: ['read', 'write'], paths: ['answer.txt', 'README.md'] }], evidence: [{ path: 'README.md', summary: 'Readme.' }] };
const task = { id: 'fx-answer', project: 'fx', situation: 'S4', origin: 'invented', kind: 'memory', memories: ['fx/answer'], prompt: 'Answer.',
  requirements: [{ id: 'answered', auto: true, text: 'answer.txt says done.' }],
  async check(dir) { const text = await readFile(join(dir, 'answer.txt'), 'utf8').catch(() => ''); const ok = text.trim() === 'done'; return { passed: ok, detail: 'answer ' + ok, requirements: { answered: ok } }; } };
export const PROJECTS = [{ id: 'fx', language: 'Text', repo: ${JSON.stringify(repo)}, base: 'HEAD', invented: true, guideTarget: 'CLAUDE.md', store: 'bench',
  memories: [memory], suite: { command: process.execPath, args: ['-e', ''], timeoutMs: 30000 }, lint: null, programs: [], strip: [], links: [],
  probeFile: 'README.md', tasks: [task] }];
`);
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { root, registry };
}
const runner = (args, env = {}) => execFileSync(process.execPath, [join(REPO, 'src', 'eval', 'bench', 'run.js'), ...args],
  { cwd: REPO, env: { ...process.env, DD_MAINTENANCE: '0', DD_BENCH_AGENT: join(REPO, 'tests', 'fixtures', 'bench', 'fake-agent.mjs'), ...env }, timeout: 240000 }).toString();

test('the runner runs each condition in a fresh clone and records the bench fields', async t => {
  const { root, registry } = fixture(t);
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=dd2,docref,none']);
  const results = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(results.taskset, 'bench');
  assert.equal(results.rows.length, 3);
  for (const row of results.rows) {
    assert.equal(row.passed, true, row.detail);
    assert.equal(row.project, 'fx');
    assert.equal(row.situation, 'S4');
    assert.equal(row.origin, 'invented');
    assert.equal(row.lint_ok, null);
    assert.equal(row.suite_passed, true);
    assert.equal(row.cost_usd, 0.01);
    assert.match(row.answer, /Wrote answer\.txt/);
  }
  const dd2 = results.rows.find(r => r.condition === 'dd2');
  assert.equal(dd2.dd_ready, true);
  assert.equal(dd2.index_memories, 1);
  assert.equal(results.rows.find(r => r.condition === 'none').dd_ready, null);
  assert.match(readFileSync(join(root, 'out', 'runs', 'fx-answer-none-0.diff'), 'utf8'), /answer\.txt/);
});

test('check-only succeeds when every check fails on an untouched clone', async t => {
  const { registry } = fixture(t);
  // The fixture's check passes only after the agent wrote the file: untouched, it fails, so check-only succeeds.
  assert.doesNotThrow(() => runner([`--registry=${registry}`, '--check-only']));
});
