import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryFiles } from '../../src/memory/store.js';

const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), 'dd-inbox-hook-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'config.js'), 'export function parseConfig(text) { return JSON.parse(text); }\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  return root;
}
const proposal = topic => JSON.stringify({ topic, kind: 'trap', title: `parseConfig ${topic}`,
  body: `Guard \`parseConfig\` against empty text (${topic}): callers pass "" when the file is missing.`,
  not_derivable: 'Callers pass an empty string only when the config file is absent.',
  triggers: [{ on: ['edit'], paths: ['src/config.js'] }], evidence: [{ type: 'file', path: 'src/config.js' }] });
const payload = (root, file) => ({ session_id: 's1', cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Write',
  tool_input: { file_path: file, content: '' }, tool_response: {} });
const hook = (input, args = ['inbox']) => spawnSync(process.execPath, [RUN, ...args], { input: JSON.stringify(input), encoding: 'utf8' });

test('a write to the inbox is answered in the same turn with what was stored', t => {
  const root = repo(t);
  const file = join(root, '.dd', 'inbox', 'a.json');
  writeFileSync(file, proposal('config/parse-config'));
  const out = hook(payload(root, file));
  assert.equal(out.status, 0);
  const { hookSpecificOutput } = JSON.parse(out.stdout);
  assert.equal(hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(hookSpecificOutput.additionalContext, /stored and active/);
  assert.equal(existsSync(file), false);
});

test('a write anywhere else says nothing and creates nothing', t => {
  const root = repo(t);
  rmSync(join(root, '.dd'), { recursive: true, force: true });
  const out = hook(payload(root, join(root, 'src', 'config.js')));
  assert.equal(out.stdout, '');
  assert.equal(existsSync(join(root, '.dd')), false);
});

test('two inbox files written in parallel are each stored once', async t => {
  const root = repo(t);
  const files = ['a', 'b'].map(name => { const file = join(root, '.dd', 'inbox', `${name}.json`); writeFileSync(file, proposal(`config/rule-${name}`)); return file; });
  await Promise.all(files.map(file => new Promise(resolve => {
    const child = spawn(process.execPath, [RUN, 'inbox'], { stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', resolve);
    child.stdin.end(JSON.stringify(payload(root, file)));
  })));
  const topics = (await createMemoryFiles(join(root, '.dd')).list()).map(memory => memory.topic).sort();
  assert.deepEqual(topics, ['config/rule-a', 'config/rule-b']);
});
