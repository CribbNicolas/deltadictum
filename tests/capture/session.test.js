import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryFiles } from '../../src/memory/store.js';

// Payload shapes recorded from Claude Code sessions:
// PostToolUseFailure carries `error`; PostToolUse for Bash carries stdout, stderr
// and `interrupted`.
const RUN = fileURLToPath(new URL('../../hooks/run.cjs', import.meta.url));
const hook = (command, payload) => spawnSync(process.execPath, [RUN, command], { input: JSON.stringify(payload), encoding: 'utf8',
  env: { ...process.env, CLAUDECODE: '1' } });
const context = out => (out.stdout ? JSON.parse(out.stdout).hookSpecificOutput.additionalContext : '');

test('a failure, a fix, a Stop request and an inbox write end in a memory delivered at the next edit', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-session-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  spawnSync('git', ['-C', root, 'init', '-q']);
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'config.js'), 'export function parseConfig(text) { return text ? JSON.parse(text) : {}; }\n');
  spawnSync('git', ['-C', root, 'add', '-A']);
  await createMemoryFiles(join(root, '.dd')).commit({ put: [] });
  hook('session-start', { session_id: 's1', cwd: root, source: 'startup' });
  const base = { session_id: 's1', cwd: root };
  hook('observe', { ...base, hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' },
    error: 'TypeError: parseConfig failed: Unexpected end of JSON input' });
  hook('observe', { ...base, hook_event_name: 'PostToolUse', tool_name: 'Edit',
    tool_input: { file_path: join(root, 'src', 'config.js'), old_string: 'JSON.parse(text)', new_string: 'text ? JSON.parse(text) : {} // parseConfig' }, tool_response: {} });
  hook('observe', { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { stdout: '# pass 4', stderr: '', interrupted: false } });
  const request = context(hook('stop', { ...base, hook_event_name: 'Stop', stop_hook_active: false }));
  assert.match(request, /fixed a failure/);
  const ref = /"type":"observation","ref":"(e[0-9a-f]+)"/.exec(request)[1];
  const file = join(root, '.dd', 'inbox', 'parse.json');
  mkdirSync(join(root, '.dd', 'inbox'), { recursive: true });
  writeFileSync(file, JSON.stringify({ topic: 'config/empty-input', kind: 'trap', title: 'parseConfig gets empty text',
    body: 'Keep the empty-text guard in `parseConfig`: a missing config file reaches it as "".',
    not_derivable: 'Only a missing config file produces empty text, and no test creates that case.',
    evidence: [{ type: 'observation', ref }, { type: 'file', path: 'src/config.js' }] }));
  const stored = context(hook('inbox', { ...base, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file, content: '' } }));
  assert.match(stored, /config\/empty-input: stored and active/);
  assert.match(stored, /suggested from this session/);
  const [memory] = await createMemoryFiles(join(root, '.dd')).list();
  assert.deepEqual(memory.triggers.find(clause => clause.paths)?.paths, ['src/config.js']);
  const delivered = context(hook('pre-tool', { ...base, session_id: 's2', hook_event_name: 'PreToolUse', tool_name: 'Edit',
    tool_input: { file_path: join(root, 'src', 'config.js'), old_string: 'a', new_string: 'b' } }));
  assert.match(delivered, /\[TRAP\] parseConfig gets empty text/);
});
