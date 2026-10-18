import { test } from 'node:test';
import assert from 'node:assert/strict';
import supermem from '../../src/eval/bench/projects/supermem.js';
import { prepareClone, removeClone } from '../../src/eval/bench/clone.js';
import { validateMemory } from '../../src/memory/schema.js';

// The store compiles at the project base and at a mined task's parent; dead globs at one base or the
// other are expected (paths moved during v2) and reported, never fatal.
for (const task of [supermem.tasks.find(t => !t.base) ?? { id: 'base', base: supermem.base }, supermem.tasks.find(t => t.id === 'supermem-session-cwd')]) {
  test(`the supermem store compiles in a dd2 clone at ${task.base ?? supermem.base}`, async t => {
    const { dir, store_warnings: warnings, index_memories: indexMemories } = await prepareClone(supermem, task, 'dd2');
    t.after(() => removeClone(dir, supermem));
    assert.equal(supermem.memories.length, 28);
    assert.equal(indexMemories, 28);
    assert.ok(Array.isArray(warnings));
  });
}

test('every supermem memory is valid once stored, and its title parses in a delivery', async () => {
  const { materializeMemories } = await import('../../src/eval/bench/store.js');
  const { memories } = await materializeMemories(process.cwd(), supermem);
  for (const m of memories) assert.deepEqual(validateMemory(m), [], m.topic);
  for (const m of supermem.memories) assert.doesNotMatch(m.title, / - |; /, m.topic);
});
