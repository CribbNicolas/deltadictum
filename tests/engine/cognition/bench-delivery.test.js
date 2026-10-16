import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliveries, listed } from '../../../src/eval/bench/delivery.js';

const hook = (event, context) => JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: event,
  stdout: JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: context } }) });
const call = (id, name) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const result = id => JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });

test('each title is timed against the first edit, once', () => {
  const stream = [
    hook('UserPromptSubmit', 'DD - project knowledge (prompt):\n[FACT] Partner API - Signs with v2.'),
    call('r1', 'Read'), hook('PreToolUse', 'DD - project knowledge (a.go):\n[TRAP] Retry jitter - Always jitter.'), result('r1'),
    call('e1', 'Edit'), hook('PreToolUse', 'DD - project knowledge (b.go):\n[DECISION] Logs go to stderr - Never stdout.\n[TRAP] Retry jitter - Always jitter.'), result('e1'),
    call('w1', 'Write'), hook('PostToolUse', 'DD - project knowledge (c.go):\n[PROCEDURE] [DISPUTED] Bump schema - Then regenerate.'), result('w1'),
  ].join('\n');
  assert.deepEqual(deliveries(stream), [
    { title: 'Partner API', at: 'before_edit', event: 'UserPromptSubmit' },
    { title: 'Retry jitter', at: 'before_edit', event: 'PreToolUse' },
    { title: 'Logs go to stderr', at: 'at_edit', event: 'PreToolUse' },
    { title: 'Bump schema', at: 'after_edit', event: 'PostToolUse' },
  ]);
});

test('a run without edits reports no_edit, and the tail lists titles without delivering them', () => {
  const stream = [call('r1', 'Read'), hook('PreToolUse', 'DD - project knowledge (a.go):\n[TRAP] Retry jitter - Always jitter.\n... and 2 more: Logs go to stderr; Bump schema'), result('r1')].join('\n');
  assert.deepEqual(deliveries(stream), [{ title: 'Retry jitter', at: 'no_edit', event: 'PreToolUse' }]);
  assert.deepEqual(listed(stream), ['Logs go to stderr', 'Bump schema']);
});

test('a known title holding " - " is read whole, not cut at its first dash', () => {
  const stream = [call('e1', 'Edit'), hook('PreToolUse', 'DD - project knowledge (a.cs):\n[DECISION] Dice fallback - physics first - Use the simulation.\n[TRAP] Plain rule - Body.')].join('\n');
  assert.deepEqual(deliveries(stream, ['Dice fallback - physics first']).map(d => d.title), ['Dice fallback - physics first', 'Plain rule']);
  assert.deepEqual(deliveries(stream).map(d => d.title), ['Dice fallback', 'Plain rule']);
});

test('a known title holding "; " is listed whole from the tail', () => {
  const known = ['State JSON is strict; versions are scattered', 'Plain rule'];
  const stream = [call('r1', 'Read'), hook('PreToolUse', 'DD - project knowledge (a.cs):\n[TRAP] Other - Body.\n... and 2 more: State JSON is strict; versions are scattered; Plain rule'), result('r1')].join('\n');
  assert.deepEqual(listed(stream, known), ['State JSON is strict; versions are scattered', 'Plain rule']);
});

test('broken lines and hooks without context are ignored', () => {
  const stream = ['not json', JSON.stringify({ type: 'system', subtype: 'hook_response', hook_event: 'Stop', stdout: '' }), call('e1', 'Edit')].join('\n');
  assert.deepEqual(deliveries(stream), []);
  assert.deepEqual(listed(stream), []);
});
