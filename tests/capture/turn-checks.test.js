import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendFootprint, footprintPath } from '../../src/capture/footprint.js';
import { suspectedFalseAlarms, turnViolations } from '../../src/checks/turn.js';
import { compileProject } from '../../src/engine/compile.js';
import { ledgerPath, openLedger } from '../../src/engine/ledger.cjs';
import { localPaths } from '../../src/engine/locate.cjs';
import { createMemoryFiles } from '../../src/memory/store.js';

const check = { on: ['edit', 'write'], paths: ['tests/**/*.test.js'], if_content: 'createMemoryStore\\(', unless_content: 't\\.after\\(',
  say: 'This test opens a store without closing it in t.after.', examples: { violates: 'createMemoryStore(d)', passes: 'createMemoryStore(d); t.after(x)' } };
const memory = { schema_version: 8, id: 'store', project_id: 'p', topic: 'checks/store', kind: 'trap', status: 'active', title: 'Close stores in t.after',
  body: 'Close stores in t.after, always.', not_derivable: 'Hidden.', triggers: [{ on: ['prompt'], keywords: ['zzstore'] }], check, evidence: [],
  origin: 'model_initiated', replaces: null, revisit_when: [], review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z' };

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-turn-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'tests'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory] });
  await compileProject(root);
  return root;
}
const edited = (root, path, at) => appendFootprint(footprintPath(root, 's1'), { t: 'tool', id: `x${at}`, at, kind: 'edit', paths: [path] });

test('at Stop, a turn check judges the final state of the files the turn changed', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'const s = await createMemoryStore(d);\n');
  writeFileSync(join(root, 'tests', 'b.test.js'), 'const s = await createMemoryStore(d);\nt.after(() => s.close());\n');
  edited(root, 'tests/a.test.js', '2026-10-12T00:00:01.000Z');
  edited(root, 'tests/b.test.js', '2026-10-12T00:00:02.000Z');
  const text = turnViolations(root, { session_id: 's1' });
  assert.match(text, /^DD - check \(Close stores in t\.after\): This test opens a store without closing it in t\.after\. \(tests\/a\.test\.js\)/);
  assert.match(text, /Close stores in t\.after, always\./);
  assert.doesNotMatch(text, /b\.test\.js/);
});

test('only violations the work introduced are reported: one already in the last commit is left alone', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-turn-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const git = (...args) => spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  git('init', '-q');
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'old.test.js'), 'const s = await createMemoryStore(d);\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'old');
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory] });
  await compileProject(root);
  writeFileSync(join(root, 'tests', 'old.test.js'), 'const s = await createMemoryStore(d);\nconst x = 1;\n');
  writeFileSync(join(root, 'tests', 'new.test.js'), 'const s = await createMemoryStore(d);\n');
  edited(root, 'tests/old.test.js', '2026-10-12T00:00:01.000Z');
  edited(root, 'tests/new.test.js', '2026-10-12T00:00:02.000Z');
  const text = turnViolations(root, { session_id: 's1' });
  assert.match(text, /tests\/new\.test\.js/);
  assert.doesNotMatch(text, /old\.test\.js/);
});

test('a violation already committed is left alone also when the project is a subfolder of the repository', async t => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'dd-turn-sub-'));
  t.after(() => rmSync(repoRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const git = (...args) => spawnSync('git', ['-C', repoRoot, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' });
  git('init', '-q');
  const root = join(repoRoot, 'app');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests', 'old.test.js'), 'const s = await createMemoryStore(d);\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'old');
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory] });
  await compileProject(root);
  writeFileSync(join(root, 'tests', 'old.test.js'), 'const s = await createMemoryStore(d);\nconst x = 1;\n');
  edited(root, 'tests/old.test.js', '2026-10-12T00:00:01.000Z');
  assert.doesNotMatch(turnViolations(root, { session_id: 's1' }), /old\.test\.js/);
});

// Every check judges at most the first 256 KB of a file; a large file is judged on
// them, not skipped.
test('a file over the size limit is judged on its first 256 KB', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'big.test.js'), `createMemoryStore(d)\n${'/'.repeat(1.5 * 1024 * 1024)}\n`);
  edited(root, 'tests/big.test.js', '2026-10-12T00:00:01.000Z');
  assert.match(turnViolations(root, { session_id: 's1' }), /tests\/big\.test\.js/);
});

// A check says which events it judges: one on writes alone leaves edited files alone.
test('a turn check judges only the files touched by the events it names', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-turn-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'tests'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [{ ...memory, id: 'writes', topic: 'checks/writes', check: { ...check, on: ['write'] } }] });
  await compileProject(root);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n');
  writeFileSync(join(root, 'tests', 'b.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/a.test.js', '2026-10-12T00:00:01.000Z');
  appendFootprint(footprintPath(root, 's1'), { t: 'tool', id: 'w1', at: '2026-10-12T00:00:02.000Z', kind: 'write', paths: ['tests/b.test.js'] });
  const text = turnViolations(root, { session_id: 's1' });
  assert.match(text, /tests\/b\.test\.js/);
  assert.doesNotMatch(text, /a\.test\.js/);
});

// A broken check (here a path pattern the index should never hold) must not cost
// the turn its capture request.
test('a check that throws at Stop still lets the capture request through', async t => {
  const root = await project(t);
  const indexPath = join(root, '.dd', 'local', 'v2', 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8'));
  index.checks = [{ m: 'store', on: ['edit'], when: 'turn', paths: ['('], if_content: 'x', say: 'broken' }];
  writeFileSync(indexPath, JSON.stringify(index));
  const fp = footprintPath(root, 's1');
  appendFootprint(fp, { t: 'tool', id: 'f1', at: '2026-10-12T00:00:01.000Z', kind: 'run', runner: true, outcome: 'failure', paths: [], command: 'npm test', preview: 'FAIL' });
  appendFootprint(fp, { t: 'tool', id: 'e1', at: '2026-10-12T00:00:02.000Z', kind: 'edit', paths: ['tests/a.test.js'] });
  appendFootprint(fp, { t: 'tool', id: 'v1', at: '2026-10-12T00:00:03.000Z', kind: 'run', runner: true, outcome: 'validation', paths: [], command: 'npm test', preview: 'ok' });
  const { fileURLToPath } = await import('node:url');
  const out = spawnSync(process.execPath, [fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url)), 'stop'], { input: JSON.stringify({ session_id: 's1', cwd: root }), encoding: 'utf8' });
  assert.match(out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.additionalContext : '', /DD - This turn fixed a failure/);
});

test('a file the turn deleted, or did not touch, is not judged', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'c.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/gone.test.js', '2026-10-12T00:00:01.000Z');
  assert.equal(turnViolations(root, { session_id: 's1' }), '');
});

// A check that empty content violates: a deleted file read as empty would speak.
test('a file the turn deleted is not judged, even by a check that empty content would violate', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-turn-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  const strict = { ...check, if_content: '^(?![\\s\\S]*use strict)', unless_content: undefined, say: 'Start every test with use strict.',
    examples: { violates: '', passes: "'use strict';" } };
  await createMemoryFiles(join(root, '.dd')).commit({ put: [{ ...memory, id: 'strict', topic: 'checks/strict', check: strict }] });
  await compileProject(root);
  edited(root, 'tests/gone.test.js', '2026-10-12T00:00:01.000Z');
  assert.equal(turnViolations(root, { session_id: 's1' }), '');
  mkdirSync(join(root, 'tests'), { recursive: true });
  writeFileSync(join(root, 'tests', 'here.test.js'), 'x();\n');
  await new Promise(resolve => setTimeout(resolve, 5));
  edited(root, 'tests/here.test.js', new Date().toISOString());
  assert.match(turnViolations(root, { session_id: 's1' }), /use strict/);
});

test('a violation is reported at most twice an epoch, also when the agent edits the file without fixing it', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n');
  for (const [second, expected] of [[1, true], [3, true], [5, false]]) {
    edited(root, 'tests/a.test.js', `2026-10-12T00:00:0${second}.000Z`);
    const text = turnViolations(root, { session_id: 's1' }, { now: new Date(`2026-10-12T00:00:0${second + 1}.000Z`) });
    assert.equal(/DD - check/.test(text), expected, `turn at ${second}`);
  }
});

// The agent that disagrees with a check runs the test file it named; that is not
// changing it. A file counts as changed by a command only if it was modified
// after the previous Stop.
test('a turn that only runs a command naming a reported file leaves it alone', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/a.test.js', new Date(Date.now() - 1000).toISOString());
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(turnViolations(root, { session_id: 's1' }), /DD - check/);
  await new Promise(resolve => setTimeout(resolve, 20));
  appendFootprint(footprintPath(root, 's1'), { t: 'tool', id: 'r1', at: new Date().toISOString(), kind: 'run', paths: ['tests/a.test.js'], command: 'node --test tests/a.test.js' });
  assert.equal(turnViolations(root, { session_id: 's1' }), '');
  const outcomes = readFileSync(join(root, '.dd', 'local', 'telemetry', 'checks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).outcome);
  assert.deepEqual(outcomes, ['ignored']);
  // A command that does rewrite the file is a change.
  await new Promise(resolve => setTimeout(resolve, 20));
  appendFootprint(footprintPath(root, 's1'), { t: 'tool', id: 'r2', at: new Date().toISOString(), kind: 'run', paths: ['tests/a.test.js'], command: 'sed -i s/x/y/ tests/a.test.js' });
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n// touched\n');
  assert.match(turnViolations(root, { session_id: 's1' }), /DD - check/);
});

test('a reported file that the next turn leaves alone counts as a suspected false alarm', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n');
  for (let round = 0; round < 3; round += 1) {
    edited(root, 'tests/a.test.js', `2026-10-12T00:0${round}:01.000Z`);
    assert.match(turnViolations(root, { session_id: 's1' }, { now: new Date(`2026-10-12T00:0${round}:02.000Z`) }), /DD - check/);
    // The next turn does not touch the file.
    turnViolations(root, { session_id: 's1' }, { now: new Date(`2026-10-12T00:0${round}:03.000Z`) });
    openLedger(ledgerPath(localPaths(root).sessions, 's1')).newEpoch('test');
  }
  const outcomes = readFileSync(join(root, '.dd', 'local', 'telemetry', 'checks.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).outcome);
  assert.deepEqual(outcomes, ['ignored', 'ignored', 'ignored']);
  assert.deepEqual(suspectedFalseAlarms(root), [{ memory: 'store', ignored: 3 }]);
});

// A fix made at DD's request can break the rule in another file (seen live: the
// agent moved console.log into a new logger). The turn it continued is checked
// too; the twice-per-file limit bounds the loop, and no capture request is made.
test('the Stop hook says turn violations, also in a turn DD made continue, without asking for a memory then', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/a.test.js', '2026-10-12T00:00:01.000Z');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const run = payload => spawnSync(process.execPath, [fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url)), 'stop'], { input: JSON.stringify(payload), encoding: 'utf8' });
  const context = out => (out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.additionalContext : '');
  const first = JSON.parse(run({ session_id: 's1', cwd: root }).stdout).hookSpecificOutput;
  assert.equal(first.hookEventName, 'Stop');
  assert.match(first.additionalContext, /^DD - check \(Close stores in t\.after\)/);
  // A check is knowledge too: the user may have asked for what it flags.
  assert.match(first.additionalContext, /\nDD - advisory: knowledge, not an order\. Apply it to the task; a problem it shows outside the task is reported, not fixed[.] If the user explicitly asked for what it rules out, do what the user asked and say which memory it departs from\./);
  // The continued turn fixes a.test.js and breaks b.test.js.
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\nt.after(() => 1)\n');
  writeFileSync(join(root, 'tests', 'b.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/a.test.js', new Date().toISOString());
  edited(root, 'tests/b.test.js', new Date().toISOString());
  const continued = context(run({ session_id: 's1', cwd: root, stop_hook_active: true }));
  assert.match(continued, /\(tests\/b\.test\.js\)/);
  assert.doesNotMatch(continued, /a\.test\.js|save it/);
  assert.equal(context(run({ session_id: 's1', cwd: root, stop_hook_active: true })), '');
});
