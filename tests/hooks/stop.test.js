import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Hook processes spawned here must not start a resident DD process (src/resident.js).
process.env.DD_RESIDENT = '0';

function hook(project, command, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url)), command,
      '--data', join(project, '.dd/local')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
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

// Phase 6 (docs/plans/2026-09-22-semantic-retrieval-plan.md): memories paid off
// only where they held what reading the code would not reveal.
test('the capture prompt asks whether an agent reading the code would miss it', async () => {
  const { STOP_CAPTURE_PROMPT } = await import('../../src/hooks/capture.js');
  assert.match(STOP_CAPTURE_PROMPT, /reading the code/i);
  assert.match(STOP_CAPTURE_PROMPT, /why not|trap|pitfall/i);
});
