import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import DeltaDictum, { ADVISORY_FRAME } from '../../adapters/opencode/index.js';
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
