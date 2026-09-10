import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STOP_CAPTURE_PROMPT } from '../../src/hooks/capture.js';

describe('Stop capture prompt', () => {
  test('asks for at most one propose and forbids transcript dumps', () => {
    assert.match(STOP_CAPTURE_PROMPT, /at most one/i);
    assert.match(STOP_CAPTURE_PROMPT, /supermem_propose/);
    assert.match(STOP_CAPTURE_PROMPT, /do not dump/i);
  });
});
