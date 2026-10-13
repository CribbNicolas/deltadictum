import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as adapter from '../../adapters/opencode/index.js';

const DeltaDictum = adapter.default;

async function fixture(t) {
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

