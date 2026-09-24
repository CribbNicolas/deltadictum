import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempRegistry } from '../helpers/resident.js';
import { openStore } from '../../src/project.js';
import { proposeMemory } from '../../src/engine/write.js';
import { requestRevision } from '../../src/engine/revisions.js';
import { HUMAN_REVIEW } from '../../src/engine/lifecycle.js';

process.env.DD_RESIDENT = '0';
await useTempRegistry();
process.env.DD_RETRIEVAL = 'lexical';

function hook(project, command, payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url)), command,
      '--data', join(project, '.dd/local')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    child.on('error', reject);
    child.on('close', code => code ? reject(new Error(`hook_failed:${code}`)) : resolve(output.trim() ? JSON.parse(output) : {}));
    child.stdin.end(JSON.stringify({ cwd: project, session_id: 'rev-session', ...payload }));
  });
}

// The reviewer's reason reaches the agent on its next prompt, once per session,
// and at the start of any other session while the request is open.
test('a revision request is delivered by the prompt and session-start hooks', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'dd-rev-hook-')), 'project');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), '{"name":"fixture"}');
  await hook(root, 'session-start', { source: 'startup' });
  const { store, projectId } = await openStore({ cwd: root, dataDir: join(root, '.dd/local') });
  const { atom } = await proposeMemory({ project_id: projectId, topic_key: 'demo/rev/hook', trigger: 'when revising through hooks',
    behavior_delta: 'Deliver the reason.', why: 'The reviewer asked.', capture_origin: 'model_initiated',
    evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] }, { store });
  await requestRevision({ kind: 'memory', id: atom.id, reason: 'Name the hook it applies to.' }, { store, projectId, actor: HUMAN_REVIEW });
  store.close();

  const first = await hook(root, 'prompt', { prompt: 'next task' });
  assert.match(first.hookSpecificOutput.additionalContext, new RegExp(`Revision requested for memory ${atom.id}.*Name the hook it applies to\\.`));
  const second = await hook(root, 'prompt', { prompt: 'another task' });
  assert.doesNotMatch(JSON.stringify(second), /Revision requested/);
  const other = await hook(root, 'session-start', { source: 'startup', session_id: 'other-session' });
  assert.match(other.hookSpecificOutput.additionalContext, /Revision requested for memory/);
});
