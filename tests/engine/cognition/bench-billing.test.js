import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSubscription } from '../../../src/eval/bench/billing.js';

test('an API key in the environment stops a paid run unless the run allows it', () => {
  assert.throws(() => assertSubscription({ ANTHROPIC_API_KEY: 'sk-x' }, {}), /api_key_set/);
  assert.doesNotThrow(() => assertSubscription({ ANTHROPIC_API_KEY: 'sk-x' }, { 'allow-api-key': '' }));
  assert.doesNotThrow(() => assertSubscription({}, {}));
});
