import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../../src/store/create-store.js';
import { startUiServer } from '../../src/ui/server.js';
import { writeUiUrl } from '../../src/hooks/banner.js';
import { estimateTokens } from '../../src/engine/budget.js';

// Hook processes spawned here must not start a resident DD process (src/resident.js).
process.env.DD_RESIDENT = '0';

const hookPath = fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url));
function invoke(root, session) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hookPath, 'pre-tool'], { cwd: root, windowsHide: true,
      env: { ...process.env, DD_DATA: join(root, 'data') }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.once('error', reject);
    child.once('exit', code => code ? reject(new Error(errors)) : resolve(JSON.parse(output || '{}')));
    child.stdin.end(JSON.stringify({ cwd: root, session_id: session, tool_name: 'Bash', tool_input: 'before writing durable memory' }));
  });
}

test('full hook process uses a real Git corpus, supports resident service and avoids duplicate context', { timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-hook-load-'));
  const ddDir = join(root, '.dd');
  const dir = join(ddDir, 'atoms', 'load', 'test');
  await mkdir(dir, { recursive: true });
  await writeFile(join(ddDir, 'config.json'), JSON.stringify({ project_id: 'demo' }));
  const count = Number(process.env.DD_STRESS_ATOMS ?? 2000);
  for (let start = 0; start < count; start += 40) await Promise.all(Array.from({ length: Math.min(40, count - start) }, async (_, offset) => {
    const i = start + offset;
    const atom = { id: `disk-${i}`, project_id: 'demo', topic_key: `load/test/item-${i}`, memory_type: 'lesson', scope: 'project',
      title: `Item ${i}`, trigger: i === 0 ? 'before writing durable memory' : `prepare isolated fixture ${i}`,
      behavior_delta: 'Validate the behavioral contract.', what: 'Validate.', why: 'Keep project knowledge reliable.',
      authority: 'validated', confidence: 0.85, lifecycle_state: 'active', valid_from: '2026-01-01T00:00:00Z',
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
      retrieval_forms: { micro: 'Validate the contract.', short: 'Validate the behavioral contract.' } };
    await writeFile(join(dir, `item-${i}.json`), JSON.stringify(atom));
  }));
  const coldStart = performance.now();
  const cold = await invoke(root, 'cold');
  const coldMs = performance.now() - coldStart;
  assert.match(cold.hookSpecificOutput?.additionalContext ?? '', /Validate/);
  assert.ok(coldMs < 10000, `cold hook ${coldMs}ms`);
  const store = await createMemoryStore({ ddDir, dataDir: join(root, 'data') });
  const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
  t.after(async () => { await ui.close(); store.close(); });
  await writeUiUrl(ddDir, ui);
  const start = performance.now();
  const resident = await invoke(root, 'resident');
  const residentMs = performance.now() - start;
  assert.match(resident.hookSpecificOutput?.additionalContext ?? '', /Validate/);
  assert.ok(residentMs < 1500, `resident hook ${residentMs}ms`);
  assert.ok(estimateTokens(resident.hookSpecificOutput.additionalContext) < 600);
  const repeated = await invoke(root, 'resident');
  assert.equal(repeated.hookSpecificOutput, undefined);
  console.log(`[hook-runtime] disk_atoms=${count} cold_ms=${Math.round(coldMs)} resident_ms=${Math.round(residentMs)}`);
});
