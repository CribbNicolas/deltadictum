import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { TRIAL_MEMORIES, materializeTrialMemories } from '../../../src/eval/agent/trial-memories.js';
import { TASKS } from '../../../src/eval/agent/tasks.js';
import { validateMemory } from '../../../src/memory/schema.js';

const REPO = fileURLToPath(new URL('../../..', import.meta.url));

// The trial's store must be a valid DD store of this codebase: every memory
// validates as a live memory, no trigger is dead against the tracked files and
// code symbols, and every file it cites exists and is hashed.
test('every trial memory materializes as a valid live memory of this repository with live triggers', async () => {
  const { memories, warnings } = await materializeTrialMemories(REPO);
  assert.equal(memories.length, TRIAL_MEMORIES.length);
  for (const memory of memories) {
    assert.deepEqual(validateMemory(memory), [], memory.topic);
    assert.equal(memory.status, 'active');
    assert.ok(memory.not_derivable.length >= 20, memory.topic);
    for (const entry of memory.evidence.filter(e => e.type === 'file')) assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${memory.topic}: ${entry.path}`);
  }
  assert.deepEqual(warnings.filter(w => w.kind.startsWith('dead_')), []);
  assert.equal(new Set(memories.map(m => m.topic)).size, memories.length);
  assert.equal(new Set(memories.map(m => m.title)).size, memories.length);
});

test('every memory task names a trial memory, controls name none, and ids are unique', () => {
  const topics = new Set(TRIAL_MEMORIES.map(m => m.topic));
  assert.equal(new Set(TASKS.map(t => t.id)).size, TASKS.length);
  assert.equal(TASKS.length, 10);
  for (const task of TASKS) {
    if (task.kind === 'memory') assert.ok(topics.has(task.memory), `${task.id} names ${task.memory}`);
    else assert.equal(task.memory, undefined, task.id);
    assert.equal(typeof task.check, 'function', task.id);
    assert.ok(task.prompt.length > 40, task.id);
  }
  assert.equal(TASKS.filter(t => t.kind === 'control').length, 3);
});
