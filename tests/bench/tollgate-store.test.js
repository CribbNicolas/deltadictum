import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFixture } from '../../src/eval/bench/projects/fixture.mjs';
import { MEMORIES } from '../../src/eval/bench/projects/tollgate/memories.js';
import { installStore } from '../../src/eval/bench/store.js';
import { validateMemory } from '../../src/memory/schema.js';

test('the tollgate store compiles in a clone: every memory valid, live ones indexed, every check kept, no warning', async t => {
  const root = mkdtempSync(join(tmpdir(), 'dd-tollgate-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const { repo } = await buildFixture('tollgate', { out: join(root, 'src') });
  const dir = join(root, 'clone');
  execFileSync('git', ['clone', '-q', repo, dir]);
  const { memories, warnings, compile_warnings: compileWarnings, index_memories: indexMemories } = await installStore(dir, { id: 'tollgate', store: 'bench', memories: MEMORIES });
  assert.equal(memories.length, 17);
  for (const m of memories) assert.deepEqual(validateMemory(m), [], m.topic);
  assert.deepEqual(warnings, []);
  assert.deepEqual(compileWarnings, []);
  assert.equal(indexMemories, 16);
  const index = JSON.parse(readFileSync(join(dir, '.dd', 'local', 'v2', 'index.json'), 'utf8'));
  assert.equal(index.checks.length, 3);
  for (const m of MEMORIES) assert.doesNotMatch(m.title, / - |; /, m.topic);
});
