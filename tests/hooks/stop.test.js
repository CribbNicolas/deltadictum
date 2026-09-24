import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempRegistry } from '../helpers/resident.js';

// Hook processes spawned here must not start a resident DD process (src/resident.js).
process.env.DD_RESIDENT = '0';
// Nor reach the machine's own resident through its registry.
await useTempRegistry();
// No resident here: these tests exercise the hooks in the explicit lexical mode.
process.env.DD_RETRIEVAL = 'lexical';

function hook(project, command, payload, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url)), command,
      '--data', join(project, '.dd/local')], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(`hook_failed:${code}`)) : resolve(output.trim() ? JSON.parse(output) : {}));
    child.stdin.end(JSON.stringify({ cwd: project, session_id: 'claude-fixture', ...payload }));
  });
}

// A capture prompt on every turn teaches the agent to propose noise and fills the
// review queue. Every host now asks only after a turn that recorded evidence.
test('Claude Code Stop stays quiet on a turn with no recorded evidence', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'dd-stop-')), 'project');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}');
  await hook(root, 'session-start', { source: 'startup' });
  assert.deepEqual(await hook(root, 'stop', {}), {});

  await hook(root, 'prompt', { prompt: 'Next task.' });
  await hook(root, 'observe', { tool_name: 'Bash', tool_input: { command: 'npm test' }, tool_response: { exit_code: 1, stderr: 'Assertion failed.' } });
  const stop = await hook(root, 'stop', {});
  assert.equal(stop.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(stop.hookSpecificOutput.additionalContext, /Available recorded evidence/);
  assert.match(stop.hookSpecificOutput.additionalContext, /most turns warrant no proposal/);
});

// Claude Code reports a failed call through PostToolUseFailure and a passing one
// through PostToolUse without an exit code; either must arm the reminder there.
test('Claude Code Stop asks after a failed or passing tool call without exit codes', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'dd-stop-cc-')), 'project');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}');
  const claudeCode = { ...process.env, CLAUDECODE: '1' };
  await hook(root, 'session-start', { source: 'startup' }, claudeCode);
  await hook(root, 'prompt', { prompt: 'Next task.' }, claudeCode);
  await hook(root, 'observe', { hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_input: { command: 'npm test' },
    error: 'Exit code 1\nAssertion failed.', is_timeout: false }, claudeCode);
  const failed = await hook(root, 'stop', {}, claudeCode);
  assert.match(failed.hookSpecificOutput.additionalContext, /"source_type":"tool_failure"/);

  await hook(root, 'prompt', { prompt: 'Try again.' }, claudeCode);
  await hook(root, 'observe', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' },
    tool_response: { stdout: 'pass 3', stderr: '', interrupted: false, isImage: false } }, claudeCode);
  const passed = await hook(root, 'stop', {}, claudeCode);
  assert.match(passed.hookSpecificOutput.additionalContext, /"source_type":"validation"/);

  // Without CLAUDECODE the same payload is not read as a pass.
  const other = { ...process.env };
  delete other.CLAUDECODE;
  await hook(root, 'prompt', { prompt: 'Third task.' }, other);
  await hook(root, 'observe', { hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm run lint' },
    tool_response: { stdout: 'ok', stderr: '', interrupted: false } }, other);
  const quiet = await hook(root, 'stop', {}, other);
  assert.deepEqual(quiet, {});
});

// Memories paid off only where they held what reading the code would not reveal.
test('the capture prompt asks whether an agent reading the code would miss it', async () => {
  const { STOP_CAPTURE_PROMPT } = await import('../../src/hooks/capture.js');
  assert.match(STOP_CAPTURE_PROMPT, /reading the code/i);
  assert.match(STOP_CAPTURE_PROMPT, /why not|trap|pitfall/i);
});
