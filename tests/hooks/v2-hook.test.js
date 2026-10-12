import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
  assert.equal(hook('pre-tool', read(root, 's1')).stdout, '');
  assert.match(context(hook('pre-tool', read(root, 's2'))), /Close stores/);
  assert.match(context(hook('pre-tool', read(root, 's1', { agent_id: 'sub-1' }))), /Close stores/);
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
  assert.equal(hook('pre-tool', read(root, 's9'), ['--codex']).stdout, '');
});
