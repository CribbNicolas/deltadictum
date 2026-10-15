import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileProject } from '../../src/engine/compile.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
const memory = (id, title, triggers) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title, body: `${title}, always.`,
  not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
});

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [
    memory('m1', 'Close stores', [{ on: ['read', 'edit'], paths: ['src/a.js'] }]),
    memory('m2', 'Adopt old data directories', [{ on: ['prompt'], keywords: ['data directory'] }]),
  ] });
  await compileProject(root);
  return root;
}
const hook = (command, payload, args = []) => spawnSync(process.execPath, [RUN, command, ...args],
  { input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8' });
const context = result => (result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.additionalContext : '');
const read = (root, session, extra = {}) => ({ session_id: session, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Read',
  tool_input: { file_path: join(root, 'src', 'a.js') }, ...extra });

test('a read of a scoped file delivers the memory once per session and once per subagent', async t => {
  const root = await project(t);
  const first = hook('pre-tool', read(root, 's1'));
  assert.equal(first.status, 0);
  assert.equal(JSON.parse(first.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(context(first), /^DD - project knowledge \(src\/a\.js\):\n\[TRAP\] Close stores - Close stores, always\.$/);
  // The claim says what fired it, at which event, and when: health reads that.
  const claim = JSON.parse(readFileSync(join(root, '.dd', 'local', 'sessions', 's1.jsonl'), 'utf8').trim().split('\n')[0]);
  assert.deepEqual([claim.m, claim.e, claim.v], ['m1', 'read', ['paths']]);
  assert.match(claim.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal(hook('pre-tool', read(root, 's1')).stdout, '');
  assert.match(context(hook('pre-tool', read(root, 's2'))), /Close stores/);
  assert.match(context(hook('pre-tool', read(root, 's1', { agent_id: 'sub-1' }))), /Close stores/);
});

// The agent reads files through Bash too (cat, sed -n, head): a memory on the file
// fires then as it does for the Read tool.
test('a cat of a scoped file through Bash is a read and delivers the memory', async t => {
  const root = await project(t);
  const out = context(hook('pre-tool', { session_id: 's1', cwd: root, tool_name: 'Bash', tool_input: { command: 'cat src/a.js' } }));
  assert.match(out, /^DD - project knowledge \(src\/a\.js\):\n\[TRAP\] Close stores/);
  const claim = JSON.parse(readFileSync(join(root, '.dd', 'local', 'sessions', 's1.jsonl'), 'utf8').trim().split('\n')[0]);
  assert.equal(claim.e, 'read');
});

// Past the 10,000-character field, memories are only named; one only named is
// not counted as delivered, so it arrives in full at the next event it fires on.
test('memories that did not fit are named, not marked delivered, and arrive in full next time', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  const long = id => ({ ...memory(id, `Rule ${id}`, [{ on: ['read'], paths: ['src/a.js'] }]), body: `Rule ${id}: ${'keep the layers apart. '.repeat(63)}` });
  const ids = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  await createMemoryFiles(join(root, '.dd')).commit({ put: ids.map(long) });
  await compileProject(root);
  const first = context(hook('pre-tool', read(root, 's1')));
  assert.ok(first.length <= 10000, `${first.length}`);
  const full = text => ids.filter(id => text.includes(`[TRAP] Rule ${id} - `));
  const named = first.slice(first.indexOf('... and ')).match(/Rule m\d/g);
  assert.ok(full(first).length >= 1 && named.length >= 1);
  const second = context(hook('pre-tool', read(root, 's1')));
  assert.deepEqual([...full(first), ...full(second)].sort(), ids);
  assert.equal(hook('pre-tool', read(root, 's1')).stdout, '');
});

test('a command run from a subfolder fires the memory for that folder, not the root one', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'packages', 'api'), { recursive: true });
  await createMemoryFiles(join(root, '.dd')).commit({ put: [
    memory('root', 'Root tests run serially', [{ on: ['run'], paths: ['tests/**'] }]),
    memory('api', 'API tests need the fixture server', [{ on: ['run'], paths: ['packages/api/tests/**'] }]),
  ] });
  await compileProject(root);
  const out = context(hook('pre-tool', { session_id: 's1', cwd: join(root, 'packages', 'api'), tool_name: 'Bash', tool_input: { command: 'node --test tests/x.test.js' } }));
  assert.match(out, /API tests need the fixture server/);
  assert.doesNotMatch(out, /Root tests run serially/);
});

// A formatter run over hundreds of files must not spend the field on its header.
test('a command naming many paths gets a short label and the memory in full', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory('fmt', 'Format src/a.js by hand', [{ on: ['run'], paths: ['src/a.js'] }])] });
  await compileProject(root);
  const files = ['src/a.js', ...Array.from({ length: 400 }, (_, i) => `src/generated/file-${i}.js`)];
  const out = context(hook('pre-tool', { session_id: 's1', cwd: root, tool_name: 'Bash', tool_input: { command: `npx prettier --write ${files.join(' ')}` } }));
  assert.ok(out.length < 1000, `${out.length}`);
  assert.match(out, /^DD - project knowledge \(src\/a\.js, src\/generated\/file-0\.js, src\/generated\/file-1\.js and 398 more\):\n\[TRAP\] Format src\/a\.js by hand - /);
});

// A plugin installed for every project runs on every tool call of projects that
// have no DD: those must not pay for loading the matcher and the index reader.
test('a tool call in a project without a compiled index loads no matching module', t => {
  const bare = mkdtempSync(join(tmpdir(), 'dd-bare-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  const hookModule = fileURLToPath(new URL('../../src/hooks/v2/hook.cjs', import.meta.url));
  const script = `require(${JSON.stringify(hookModule)}).handle('pre-tool', { cwd: ${JSON.stringify(bare)}, tool_name: 'Read', tool_input: { file_path: 'a.js' } })
    .then(() => console.log(JSON.stringify(Object.keys(require.cache).map(p => p.split(/[\\\\/]/).pop()))))`;
  const loaded = JSON.parse(spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' }).stdout);
  for (const name of ['match.cjs', 'clause.cjs', 'text.cjs', 'index-file.cjs', 'events.cjs']) assert.ok(!loaded.includes(name), `${name} loaded`);
});

// A memory is never delivered, or counted as delivered, without its body.
test('an index whose bodies are missing delivers nothing until session start recompiles it', async t => {
  const root = await project(t);
  const v2 = join(root, '.dd', 'local', 'v2');
  for (const name of readdirSync(v2).filter(name => name.startsWith('bodies'))) rmSync(join(v2, name));
  assert.equal(hook('pre-tool', read(root, 's1')).stdout, '');
  hook('session-start', { session_id: 's1', cwd: root, hook_event_name: 'SessionStart', source: 'startup' });
  assert.match(context(hook('pre-tool', read(root, 's1'))), /\[TRAP\] Close stores - Close stores, always\./);
});

// A partial install or a checkout on another branch must not turn every tool call
// into a hook error: a module that fails to load ends the hook silently too.
test('a hook whose modules cannot load exits 0 with no output', t => {
  const plugin = mkdtempSync(join(tmpdir(), 'dd-partial-'));
  t.after(() => rmSync(plugin, { recursive: true, force: true }));
  mkdirSync(join(plugin, 'hooks'));
  for (const name of ['run.cjs', 'node-support.cjs']) copyFileSync(fileURLToPath(new URL(`../../hooks/${name}`, import.meta.url)), join(plugin, 'hooks', name));
  const out = spawnSync(process.execPath, [join(plugin, 'hooks', 'run.cjs'), 'pre-tool'], { input: '{"tool_name":"Read","tool_input":{}}', encoding: 'utf8' });
  assert.deepEqual({ status: out.status, stdout: out.stdout, stderr: out.stderr }, { status: 0, stdout: '', stderr: '' });
});

test('a prompt naming a keyword delivers its memory', async t => {
  const root = await project(t);
  const result = hook('prompt', { session_id: 's1', cwd: root, hook_event_name: 'UserPromptSubmit', prompt: 'Rename the data directory' });
  assert.equal(JSON.parse(result.stdout).hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(context(result), /\[TRAP\] Adopt old data directories/);
});

test('session start compiles a missing index and says nothing; compaction re-arms delivery', async t => {
  const root = await project(t);
  rmSync(join(root, '.dd', 'local', 'v2'), { recursive: true, force: true });
  const start = hook('session-start', { session_id: 's1', cwd: root, hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(start.status, 0);
  assert.equal(start.stdout, '');
  assert.ok(existsSync(join(root, '.dd', 'local', 'v2', 'index.json')));
  assert.match(context(hook('pre-tool', read(root, 's1'))), /Close stores/);
  assert.equal(hook('pre-tool', read(root, 's1')).stdout, '');
  hook('session-start', { session_id: 's1', cwd: root, hook_event_name: 'SessionStart', source: 'compact' });
  assert.match(context(hook('pre-tool', read(root, 's1'))), /Close stores/);
});

// A project opts in by having a .dd/ folder (a committed .dd/config.json is the
// team's way): before its first memory, DD recorded no footprint and never asked
// at Stop, while the README said it would. The folder also marks the project
// root, so a hook run from a subfolder of a project without .git finds it.
test('a project with .dd/ and no memory yet records its footprint, asks at Stop and compiles at session start', t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-optin-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.dd'));
  writeFileSync(join(root, '.dd', 'config.json'), '{}\n');
  mkdirSync(join(root, 'src'));
  const cwd = join(root, 'src');
  const observe = (tool_name, tool_input, tool_response) => hook('observe', { session_id: 's1', cwd, tool_name, tool_input, tool_response });
  observe('Bash', { command: 'npm test' }, { exit_code: 1, output: 'FAIL parseConfig is not a function' });
  observe('Edit', { file_path: join(root, 'src', 'a.js'), new_string: 'parseConfig' }, { exit_code: 0 });
  observe('Bash', { command: 'npm test' }, { exit_code: 0, output: 'ok' });
  assert.ok(existsSync(join(root, '.dd', 'local', 'sessions', 's1.footprint.jsonl')));
  assert.match(context(hook('stop', { session_id: 's1', cwd })), /^DD - This turn fixed a failure/);
  const start = hook('session-start', { session_id: 's1', cwd, source: 'startup' });
  assert.equal(start.stdout, '');
  assert.ok(existsSync(join(root, '.dd', 'local', 'v2', 'index.json')));
});

test('tools, projects and inputs DD has nothing for stay silent and create nothing', async t => {
  const root = await project(t);
  assert.equal(hook('pre-tool', { session_id: 's', cwd: root, tool_name: 'TodoWrite', tool_input: {} }).stdout, '');
  const bare = mkdtempSync(join(tmpdir(), 'dd-bare-'));
  t.after(() => rmSync(bare, { recursive: true, force: true }));
  const none = hook('session-start', { session_id: 's', cwd: bare, source: 'startup' });
  assert.equal(none.status, 0);
  assert.equal(none.stdout, '');
  assert.equal(existsSync(join(bare, '.dd')), false);
  const torn = hook('pre-tool', '{ not json');
  assert.equal(torn.status, 0);
  assert.equal(torn.stdout, '');
  assert.equal(hook('observe', read(root, 's1')).stdout, '');
});

// The cap comes from the project's settings (compiled into the index, so the hook reads
// no extra file), and each delivery leaves a ledger line the roll-up turns into telemetry.
test('delivery_limit in .dd/config.json caps a delivery, and the delivery is recorded in the ledger', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, '.dd'));
  writeFileSync(join(root, '.dd', 'config.json'), JSON.stringify({ project_id: 'p', delivery_limit: 2000 }));
  const long = id => ({ ...memory(id, `Rule ${id}`, [{ on: ['read'], paths: ['src/a.js'] }]), body: `Rule ${id}: ${'keep the layers apart. '.repeat(40)}` });
  await createMemoryFiles(join(root, '.dd')).commit({ put: ['m1', 'm2', 'm3', 'm4'].map(long) });
  await compileProject(root);
  const first = context(hook('pre-tool', read(root, 's1')));
  assert.ok(first.length <= 2000 && first.length > 1000, `${first.length}`);
  const lines = readFileSync(join(root, '.dd', 'local', 'sessions', 's1.jsonl'), 'utf8').trim().split('\n').map(text => JSON.parse(text));
  const record = lines.find(entry => entry.t === 'delivery');
  assert.deepEqual([record.e, record.m >= 1, record.x >= 1, record.c], ['read', true, true, first.length]);
  assert.match(record.at, /^\d{4}-\d\d-\d\dT/);
});
