import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../../src/engine/compile.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
const memory = (id, title, extra) => ({ schema_version: 8, id, project_id: 'p', topic: `checks/${id}`, kind: 'trap', status: 'active', title,
  body: `${title}, always.`, not_derivable: 'Hidden.', triggers: [{ on: ['prompt'], keywords: [`zz${id}`] }], evidence: [], origin: 'model_initiated',
  replaces: null, revisit_when: [], review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z', ...extra });
const hook = payload => spawnSync(process.execPath, [RUN, 'pre-tool'], { input: JSON.stringify(payload), encoding: 'utf8' });
const context = out => (out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.additionalContext : '');

async function project(t, memories) {
  const root = mkdtempSync(join(tmpdir(), 'dd-checks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'tests', 'a.test.js'), 'const s = await createMemoryStore(d);\nt.after(() => s.close());\n');
  await createMemoryFiles(join(root, '.dd')).commit({ put: memories });
  await compileProject(root);
  return root;
}
const force = memory('force', 'Never force-exit tests', { check: { on: ['run'], if_command: '--test-force-exit', say: '--test-force-exit crashes the resident tests on Windows.',
  examples: { violates: 'node --test --test-force-exit', passes: 'node --test' } } });
const store = memory('store', 'Close stores in t.after', { check: { on: ['edit', 'write'], when: 'edit', paths: ['tests/**/*.test.js'], if_content: 'createMemoryStore\\(',
  unless_content: 't\\.after\\(', say: 'This test opens a store without closing it in t.after.',
  examples: { violates: 'createMemoryStore(d)', passes: 'createMemoryStore(d); t.after(x)' } } });

test('a command check speaks with the command, with the body the first time, at most twice an epoch', async t => {
  const root = await project(t, [force]);
  const run = session => context(hook({ session_id: session, cwd: root, tool_name: 'Bash', tool_input: { command: 'node --test --test-force-exit tests' } }));
  const first = run('s1');
  assert.match(first, /DD - check \(Never force-exit tests\): --test-force-exit crashes the resident tests on Windows\./);
  assert.match(first, /Never force-exit tests, always\./);
  const second = run('s1');
  assert.match(second, /DD - check/);
  assert.doesNotMatch(second, /always\./);
  assert.equal(run('s1'), '');
  assert.equal(context(hook({ session_id: 's1', cwd: root, tool_name: 'Bash', tool_input: { command: 'node --test tests' } })), '');
});

test('an edit check judges the file as the edit would leave it', async t => {
  const root = await project(t, [store]);
  const edit = (old_string, new_string) => context(hook({ session_id: 's1', cwd: root, tool_name: 'Edit',
    tool_input: { file_path: join(root, 'tests', 'a.test.js'), old_string, new_string } }));
  assert.match(edit('t.after(() => s.close());', 'await s.close();'), /without closing it in t\.after/);
  assert.equal(edit('const s', 'const store'), '');
  assert.equal(edit('not in the file', 'whatever'), '');
  const write = context(hook({ session_id: 's2', cwd: root, tool_name: 'Write', tool_input: { file_path: join(root, 'tests', 'b.test.js'), content: 'createMemoryStore(d)' } }));
  assert.match(write, /without closing it in t\.after/);
});

// Turn checks wait for Stop, and an edit check on other files does not apply:
// neither may cost an Edit the check machinery (measured: about 2.5 ms).
test('checks that do not apply to the tool call load no check module', async t => {
  const turnOnly = memory('turnonly', 'Turn rule', { check: { ...store.check, when: undefined } });
  const elsewhere = memory('elsewhere', 'Elsewhere rule', { check: { ...store.check, paths: ['docs/**/*.md'] } });
  const root = await project(t, [turnOnly, elsewhere]);
  const hookModule = fileURLToPath(new URL('../../src/hooks/v2/hook.cjs', import.meta.url));
  const payload = { session_id: 's', cwd: root, tool_name: 'Edit', tool_input: { file_path: join(root, 'tests', 'a.test.js'), old_string: 'const s', new_string: 'const t' } };
  const script = `require(${JSON.stringify(hookModule)}).handle('pre-tool', ${JSON.stringify(payload)})
    .then(() => console.log(JSON.stringify(Object.keys(require.cache).map(p => p.split(/[\\\\/]/).pop()))))`;
  const loaded = JSON.parse(spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout);
  for (const name of ['pattern.cjs', 'check.cjs', 'tool.cjs', 'ledger.cjs']) assert.ok(!loaded.includes(name), `${name} loaded`);
});

test('a project whose memories have no check loads no check module at the tool call', async t => {
  const root = await project(t, [memory('plain', 'Plain rule', {})]);
  const hookModule = fileURLToPath(new URL('../../src/hooks/v2/hook.cjs', import.meta.url));
  const script = `require(${JSON.stringify(hookModule)}).handle('pre-tool', { session_id: 's', cwd: ${JSON.stringify(root)}, tool_name: 'Bash', tool_input: { command: 'ls' } })
    .then(() => console.log(JSON.stringify(Object.keys(require.cache).map(p => p.split(/[\\\\/]/).pop()))))`;
  const loaded = JSON.parse(spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout);
  for (const name of ['pattern.cjs', 'check.cjs', 'tool.cjs']) assert.ok(!loaded.includes(name), `${name} loaded`);
});
