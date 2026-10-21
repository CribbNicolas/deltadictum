import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMemory } from '../../src/eval/replay/classify.js';

const memory = (title, body) => ({ topic: 'a/b', title, body });

test('a memory naming repository paths, identifiers, commands or values reads as information', () => {
  const m = classifyMemory(memory('Reachable ceilings', 'Set confidence_threshold in src/store/paths.js to 0.85, never 0.8.'));
  assert.equal(m.class, 'information');
  assert.deepEqual(m.signals, ['path', 'identifier', 'value']);
  assert.deepEqual(classifyMemory(memory('Run tests', 'Run `npm run test:stress` before release.')).signals, ['command']);
});

test('one signal is unsure and none is generic', () => {
  assert.equal(classifyMemory(memory('Run tests', 'Run `npm run test:stress` before release.')).class, 'unsure');
  assert.equal(classifyMemory(memory('Write tests', 'Write tests for new code. Why: tests catch bugs.')).class, 'generic');
});
