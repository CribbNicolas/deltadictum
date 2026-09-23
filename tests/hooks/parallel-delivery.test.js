import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { useTempRegistry } from '../helpers/resident.js';

process.env.DD_RESIDENT = '0';
// Nor reach the machine's own resident through its registry.
await useTempRegistry();
// No resident here: these tests exercise the hooks in the explicit lexical mode.
process.env.DD_RETRIEVAL = 'lexical';

function preTool(root, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../src/hooks/run.js', import.meta.url)), 'pre-tool', '--data', join(root, 'data')],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', () => resolve(output));
    child.stdin.end(JSON.stringify({ cwd: root, session_id: 'parallel-tools', tool_name: 'Edit', tool_input: input }));
  });
}

// A harness runs parallel tool calls as parallel hook processes. Each checked
// the delivery log before either wrote it, so both injected the same memory.
test('parallel hook processes inject a memory once per session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-parallel-'));
  await mkdir(join(root, '.git'));
  await writeFile(join(root, 'README.md'), 'Layers.');
  await mkdir(join(root, '.dd'));
  await writeFile(join(root, '.dd', 'config.json'), JSON.stringify({ project_id: 'demo' }));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  const r = await proposeMemory({ project_id: 'demo', memory_type: 'decision', topic_key: 'architecture/core/layers',
    trigger: 'when changing domain rules', behavior_delta: 'Keep rules in domain.', why: 'Layers stay testable.',
    applies_to: { files: ['src/domain/**'] }, evidence_refs: [{ source_type: 'file', source_ref: 'README.md', summary: 'Layers' }] }, { store });
  await admitMemory(r.atom.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Documented.' });
  store.close();
  const outputs = await Promise.all(Array.from({ length: 6 }, (_, i) =>
    preTool(root, { file_path: join(root, 'src', 'domain', `F${i}.cs`), old_string: 'a', new_string: 'b' })));
  const injected = outputs.filter(o => o.includes('Keep rules in domain')).length;
  assert.equal(injected, 1);
});
