import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as adapter from '../../adapters/opencode/index.js';
import { ADVISORY_FRAME } from '../../adapters/opencode/frame.js';
import { applyOpencodeInstall, planOpencodeInstall } from '../../scripts/install-opencode.mjs';
import { compileProject } from '../../src/engine/compile.js';
import { createMemoryFiles } from '../../src/memory/store.js';

const DeltaDictum = adapter.default;
const memory = (id, title, triggers) => ({
  schema_version: 8, id, project_id: 'p', topic: `testing/${id}`, kind: 'trap', status: 'active', title, body: `${title}, always.`,
  not_derivable: 'Hidden.', triggers, evidence: [], origin: 'model_initiated', replaces: null, revisit_when: [],
  review: { issues: [] }, created: '2026-09-01T00:00:00.000Z', updated: '2026-09-01T00:00:00.000Z',
});

// The adapter starts `observe` without waiting for it (a hook never holds the host up), and that child
// writes the session's footprint into the project after the test is done: on a slow Windows runner Node
// takes seconds to start, and a one-second cleanup failed with ENOTEMPTY (2026-10-18, the 0.9.9 publish).
// Asynchronously: rmSync gives up at the folder's first refusal whatever maxRetries says (2026-10-20, again).
const CLEANUP = { recursive: true, force: true, maxRetries: 75, retryDelay: 200 };
const removeDir = path => rm(path, CLEANUP);

async function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-opencode-'));
  t.after(() => removeDir(root));
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
  t.after(() => removeDir(bare));
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

// A memory the agent writes into the inbox is ingested at once and the reply joins the write's result,
// as the PostToolUse inbox hook does elsewhere (verified live with OpenCode 1.19.3, 2026-10-22).
test('a memory written into the inbox is stored and the reply joins the write\'s result', async t => {
  const root = await project(t);
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'add', '-A']);
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  const file = join(root, '.dd', 'inbox', 'a.json');
  const proposal = { topic: 'config/a-constant', kind: 'fact', title: 'a is one on purpose', body: 'Keep `a` in src/a.js at 1: the importer reads it as a version.',
    not_derivable: 'The importer lives in another repository.', triggers: [{ on: ['edit'], paths: ['src/a.js'] }], evidence: [{ type: 'file', path: 'src/a.js' }] };
  writeFileSync(file, JSON.stringify(proposal));
  const hooks = await DeltaDictum({ directory: root });
  const result = await toolCall(hooks, 's5', 'write', { filePath: file, content: JSON.stringify(proposal) });
  assert.match(result, /^tool result\n\nDD - config\/a-constant: stored/);
});

// deltadictum install --host opencode: the plugin entry, the skills where OpenCode reads them, AGENTS.md.
test('the OpenCode install names this adapter, keeps other plugins and writes the skills under .opencode', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-opencode-install-'));
  t.after(() => removeDir(root));
  writeFileSync(join(root, 'opencode.json'), JSON.stringify({ model: 'x/y', plugin: ['other-plugin', 'deltadictum@0.9.0'] }));
  const plan = await planOpencodeInstall(root);
  await applyOpencodeInstall(plan);
  const config = JSON.parse(readFileSync(join(root, 'opencode.json'), 'utf8'));
  assert.equal(config.model, 'x/y');
  assert.equal(config.plugin.length, 2);
  assert.equal(config.plugin[0], 'other-plugin');
  assert.match(config.plugin[1], /^file:\/\/\/.+\/adapters\/opencode\/index\.js$/);
  for (const skill of ['dd-save', 'dd-recall', 'dd-review']) assert.match(readFileSync(join(root, '.opencode', 'skills', skill, 'SKILL.md'), 'utf8'), new RegExp(`^---\r?\nname: ${skill}`));
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /save it with the dd-save skill/);
  assert.equal((await planOpencodeInstall(root)).operations.length, 0);
});
