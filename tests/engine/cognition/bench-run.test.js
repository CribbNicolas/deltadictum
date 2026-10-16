import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]).toString();

// suite: the fixture suite's node arguments; extra: more task literals, built from `task`.
function fixture(t, { suite = "['-e', '']", extra = '' } = {}) {
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
  memories: [memory], suite: { command: process.execPath, args: ${suite}, timeoutMs: 30000 }, lint: null, programs: [], strip: [], links: [],
  probeFile: 'README.md', tasks: [task${extra ? `, ${extra}` : ''}] }];
`);
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { root, registry };
}
const runner = (args, env = {}) => execFileSync(process.execPath, [join(REPO, 'src', 'eval', 'bench', 'run.js'), ...args],
  { cwd: REPO, env: { ...process.env, DD_MAINTENANCE: '0', DD_BENCH_AGENT: join(REPO, 'tests', 'fixtures', 'bench', 'fake-agent.mjs'), ...env }, timeout: 240000, stdio: 'pipe' }).toString();
const rowsOf = out => JSON.parse(readFileSync(out, 'utf8')).rows;

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

test('check-only fails when the project suite does not pass on an untouched clone', async t => {
  const { registry } = fixture(t, { suite: "['-e', 'process.exit(1)']" });
  assert.throws(() => runner([`--registry=${registry}`, '--check-only']));
});

test('work the agent committed is still its change: the diff is taken against the baseline commit', async t => {
  const { root, registry } = fixture(t);
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none'], { FAKE_AGENT_COMMIT: '1' });
  assert.match(readFileSync(join(root, 'out', 'runs', 'fx-answer-none-0.diff'), 'utf8'), /answer\.txt/);
  assert.match(rowsOf(out)[0].numstat, /answer\.txt/);
});

test('a check that reads the change against HEAD sees work the agent committed', async t => {
  const extra = `{ ...task, id: 'fx-head', async check(dir) {
    const { execFileSync } = await import('node:child_process');
    const ok = execFileSync('git', ['-C', dir, 'diff', 'HEAD', '--name-only']).toString().includes('answer.txt');
    return { passed: ok, detail: 'changed against HEAD ' + ok, requirements: { answered: ok } }; } }`;
  const { root, registry } = fixture(t, { extra });
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none', '--tasks=fx-head'], { FAKE_AGENT_COMMIT: '1' });
  assert.equal(rowsOf(out)[0].passed, true, rowsOf(out)[0].detail);
});

test('--no-suite (calibration decides on checks alone) runs neither the suite nor lint and says so in the row', async t => {
  const { root, registry } = fixture(t, { suite: "['-e', 'process.exit(1)']" });
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none', '--no-suite']);
  const [row] = rowsOf(out);
  assert.equal(row.passed, true);
  assert.equal(row.suite_passed, null);
  assert.equal(row.suite_skipped, true);
  assert.equal(row.suite_baseline_passed, null);
});

test('an agent that changed nothing, on a suite that always fails, is recorded as undecided and the run goes on', async t => {
  const { root, registry } = fixture(t, { suite: "['-e', 'process.exit(1)']" });
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none'], { FAKE_AGENT_NOOP: '1' });
  const [row] = rowsOf(out);
  assert.equal(row.suite_passed, null);
  assert.equal(row.suite_baseline_passed, false);
});

test('a suite failure the change caused is a regression, judged against a fresh baseline', async t => {
  const { root, registry } = fixture(t, { suite: "['-e', 'process.exit(require(\"fs\").existsSync(\"answer.txt\") ? 1 : 0)']" });
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none']);
  const [row] = rowsOf(out);
  assert.equal(row.suite_passed, false);
  assert.equal(row.suite_baseline_passed, true);
});

test('a harness error in one run is logged and the other runs still record', async t => {
  const { root, registry } = fixture(t, { extra: "{ ...task, id: 'fx-broken', setup: async () => { throw new Error('broken setup'); } }" });
  const out = join(root, 'out', 'results.json');
  runner([`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none']);
  assert.deepEqual(rowsOf(out).map(r => r.task), ['fx-answer']);
  const errors = readFileSync(join(root, 'out', 'results.errors.jsonl'), 'utf8');
  assert.match(errors, /fx-broken-none-0/);
  assert.match(errors, /broken setup/);
});

test('a run into recorded rows without --resume or --fresh is refused and the rows stay', async t => {
  const { root, registry } = fixture(t);
  const out = join(root, 'out', 'results.json');
  const args = [`--registry=${registry}`, '--model=fake', `--out=${out}`, '--repeat=1', '--conditions=none'];
  runner(args);
  assert.throws(() => runner(args), /rows_exist/);
  assert.ok(existsSync(join(root, 'out', 'results.rows.jsonl')));
  assert.equal(readFileSync(join(root, 'out', 'results.rows.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.doesNotThrow(() => runner([...args, '--fresh']));
});
