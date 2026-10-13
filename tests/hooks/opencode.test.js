import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as adapter from '../../adapters/opencode/index.js';
import { ADVISORY_FRAME } from '../../adapters/opencode/frame.js';
import { compileProject } from '../../src/engine/compile.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const DeltaDictum = adapter.default;
const memory = (id, title, triggers) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title, body: `${title}, always.`,
  not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { migrated: false, issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
});

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-opencode-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await createMemoryFiles(join(root, '.dd')).commit({ put: [memory('m1', 'Close stores', [{ on: ['read', 'edit'], paths: ['src/a.js'] }])] });
  await compileProject(root);
  return root;
}

// The plugin API's shapes (@opencode-ai/plugin Hooks): a tool call's input names
// the tool, the session and the call; its result is { title, output, metadata }.
async function toolCall(hooks, sessionID, tool, args) {
  const input = { tool, sessionID, callID: `${tool}-${Math.random()}` };
  await hooks['tool.execute.before'](input, { args });
  const output = { title: tool, output: 'tool result', metadata: {} };
  await hooks['tool.execute.after'](input, output);
  return output.output;
}

test('a tool call delivers its memories in the tool result, once per session', async t => {
  const root = await project(t);
  const hooks = await DeltaDictum({ directory: root });
  const first = await toolCall(hooks, 's1', 'read', { filePath: join(root, 'src', 'a.js') });
  assert.ok(first.startsWith('tool result\n\n'));
  assert.ok(first.includes(ADVISORY_FRAME));
  assert.match(first, /DD - project knowledge \(src\/a\.js\):\n\[TRAP\] Close stores/);
  assert.equal(await toolCall(hooks, 's1', 'edit', { filePath: 'src/a.js', oldString: '1', newString: '2' }), 'tool result');
  assert.match(await toolCall(hooks, 's2', 'edit', { filePath: 'src/a.js', oldString: '1', newString: '2' }), /Close stores/);
  assert.equal(await toolCall(hooks, 's3', 'bash', { command: 'npm test' }), 'tool result');
});

test('the system prompt is left alone, so the prompt cache holds', async t => {
  const root = await project(t);
  const hooks = await DeltaDictum({ directory: root });
  const output = { system: ['host prompt'] };
  await hooks['experimental.chat.system.transform']({ sessionID: 's1', model: {} }, output);
  assert.deepEqual(output.system, ['host prompt']);
});

test('a tool call without a session or in a project without DD changes nothing', async t => {
  const bare = mkdtempSync(join(tmpdir(), 'dd-opencode-bare-'));
  t.after(() => rmSync(bare, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 }));
  const hooks = await DeltaDictum({ directory: bare });
  assert.equal(await toolCall(hooks, 's1', 'read', { filePath: join(bare, 'a.js') }), 'tool result');
  const root = await project(t);
  assert.equal(await toolCall(await DeltaDictum({ directory: root }), undefined, 'read', { filePath: 'src/a.js' }), 'tool result');
});

// OpenCode runs plugins in Bun, which has no node:sqlite: importing DD's store
// failed the plugin at load (OpenCode 1.16.2, 2026-09-24). The adapter imports
// no DD module and runs DD's hooks in Node instead.
test('the OpenCode adapter imports nothing Bun cannot load, exports only the plugin, and OpenCode finds its server entrypoint', () => {
  const source = readFileSync(new URL('../../adapters/opencode/index.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import .* from '([^']+)';/gm)].map(m => m[1]);
  assert.deepEqual(imports.sort(), ['./frame.js', 'node:child_process', 'node:url']);
  // OpenCode calls every export of the module as a plugin function.
  assert.deepEqual(Object.keys(adapter), ['default']);
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.exports['./server'], './adapters/opencode/index.js');
});
