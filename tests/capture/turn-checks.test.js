import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('a file the turn deleted, or did not touch, is not judged', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'c.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/gone.test.js', '2026-10-12T00:00:01.000Z');
  assert.equal(turnViolations(root, { session_id: 's1' }), '');
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

test('the Stop hook says a turn violation, and nothing when it is already continuing', async t => {
  const root = await project(t);
  writeFileSync(join(root, 'tests', 'a.test.js'), 'createMemoryStore(d)\n');
  edited(root, 'tests/a.test.js', '2026-10-12T00:00:01.000Z');
  const { spawnSync } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const run = payload => spawnSync(process.execPath, [fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url)), 'stop'], { input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(run({ session_id: 's1', cwd: root, stop_hook_active: true }).stdout, '');
  const out = JSON.parse(run({ session_id: 's1', cwd: root }).stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'Stop');
  assert.match(out.additionalContext, /^DD - check \(Close stores in t\.after\)/);
});
