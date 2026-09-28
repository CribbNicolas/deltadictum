import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as adapter from '../../adapters/opencode/index.js';
import { ADVISORY_FRAME } from '../../adapters/opencode/frame.js';

const DeltaDictum = adapter.default;
import { useTempRegistry } from '../helpers/resident.js';

// The adapter must not start a resident DD process here (src/resident.js).
process.env.DD_RESIDENT = '0';
// Nor reach the machine's own resident through its registry.
await useTempRegistry();

async function fixture(t) {
  await useTempRegistry(t);
  const base = await mkdtemp(join(tmpdir(), 'dd-opencode-'));
  const root = join(base, 'project');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}\n');
  const previous = process.env.DD_DATA;
  process.env.DD_DATA = join(base, 'data');
  t.after(() => { if (previous === undefined) delete process.env.DD_DATA; else process.env.DD_DATA = previous; });
  return root;
}

async function turn(hooks, sessionID) {
  const output = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID, model: {} }, output);
  return output.system;
}

test('OpenCode adapter says DD is inactive, once per session, when no resident serves it', async t => {
  const root = await fixture(t);
  const hooks = await DeltaDictum({ directory: root });
  const first = await turn(hooks, 's1');
  assert.equal(first.length, 1);
  assert.match(first[0], /DD - Inactive: the resident DD process is disabled/);
  assert.doesNotMatch(first[0], /Project context/i);
  assert.deepEqual(await turn(hooks, 's1'), []);
  assert.equal((await turn(hooks, 's2')).length, 1);
});

test('OpenCode adapter injects session context in the explicit lexical mode', async t => {
  const root = await fixture(t);
  process.env.DD_RETRIEVAL = 'lexical';
  t.after(() => { delete process.env.DD_RETRIEVAL; });
  const hooks = await DeltaDictum({ directory: root });
  const [context] = await turn(hooks, 's1');
  assert.ok(context);
  assert.doesNotMatch(context, /Inactive/);
  // It lands in the system prompt, so it says it is advisory and ranks below the user and the host.
  assert.ok(context.startsWith(ADVISORY_FRAME));
});

test('OpenCode adapter ignores turns without a session id', async t => {
  const root = await fixture(t);
  const hooks = await DeltaDictum({ directory: root });
  assert.deepEqual(await turn(hooks, undefined), []);
});

// OpenCode runs plugins in Bun, which has no node:sqlite: importing DD's store
// failed the plugin at load (OpenCode 1.16.2, 2026-09-24). The adapter imports
// no DD module and runs the SessionStart hook in Node instead.
test('the OpenCode adapter imports nothing Bun cannot load, exports only the plugin, and OpenCode finds its server entrypoint', async () => {
  const source = await readFile(new URL('../../adapters/opencode/index.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./frame.js', 'node:child_process', 'node:url']);
  // OpenCode calls every export of the module as a plugin function.
  assert.deepEqual(Object.keys(adapter), ['default']);
  const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./server'], './adapters/opencode/index.js');
});

// OpenCode cannot inject per tool call, so the session memory map is how its
// agent sees every memory it can pull.
test('OpenCode receives the memory map in its system prompt', async t => {
  const root = await fixture(t);
  process.env.DD_RETRIEVAL = 'lexical';
  t.after(() => { delete process.env.DD_RETRIEVAL; });
  const { openStore } = await import('../../src/project.js');
  const { PROVENANCE } = await import('../helpers/atom.js');
  const { store, projectId } = await openStore({ cwd: root });
  await store.putAtom({ id: 'map-1', project_id: projectId, memory_type: 'lesson', scope: 'project', title: 'Keep the tray stable',
    trigger: 'when changing the dice tray', behavior_delta: 'Keep it stable.', what: 'x', why: 'y', authority: 'validated', confidence: 0.8,
    valid_from: '2026-09-01T00:00:00.000Z', topic_key: 'dice/tray/stable', tags: [], ...PROVENANCE, lifecycle_state: 'active',
    retrieval_forms: { micro: 'Keep it stable.' } });
  store.close();
  const hooks = await DeltaDictum({ directory: root });
  const [context] = await turn(hooks, 's1');
  assert.match(context, /DD - Memory map \(1\)/);
  assert.ok(context.includes('dice/tray/stable — when changing the dice tray'));
});
