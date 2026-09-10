import { describe, test } from 'node:test';
import assert from 'node:assert';
import { classifyIntent, profileFor } from '../../../src/engine/v4/intent.js';

describe('V4 intent classifier', () => {
  test('classifies debug intent from failure vocabulary (en/es)', () => {
    assert.strictEqual(classifyIntent({ action: 'fix failing migration test' }), 'debug');
    assert.strictEqual(classifyIntent({ action: 'revisar por que falla el worker' }), 'debug');
  });

  test('classifies causal intent from why/cause vocabulary', () => {
    assert.strictEqual(classifyIntent({ action: 'explain decision', query: 'why did we choose qdrant' }), 'causal');
    assert.strictEqual(classifyIntent({ query: 'por qué usamos compose modular' }), 'causal');
  });

  test('classifies temporal intent from time vocabulary', () => {
    assert.strictEqual(classifyIntent({ query: 'when did retrieval change' }), 'temporal');
    assert.strictEqual(classifyIntent({ query: 'historial de cambios del esquema' }), 'temporal');
  });

  test('classifies policy intent from rule vocabulary', () => {
    assert.strictEqual(classifyIntent({ action: 'check invariant before write' }), 'policy');
    assert.strictEqual(classifyIntent({ query: 'qué regla aplica a namespaces' }), 'policy');
  });

  test('classifies global intent from overview vocabulary', () => {
    assert.strictEqual(classifyIntent({ query: 'give me an overview of the memory system' }), 'global');
  });

  test('debug wins over causal when both match', () => {
    assert.strictEqual(classifyIntent({ query: 'why is the test failing' }), 'debug');
  });

  test('falls back to factual for unclassifiable input', () => {
    assert.strictEqual(classifyIntent({ action: 'create lesson about compose' }), 'factual');
  });

  test('classifies abstain for empty input', () => {
    assert.strictEqual(classifyIntent({}), 'abstain');
    assert.strictEqual(classifyIntent({ action: '   ' }), 'abstain');
  });

  test('profiles map intents to form and type preferences', () => {
    assert.deepStrictEqual(profileFor('debug'), {
      form_type: 'short',
      memory_types: ['lesson', 'anti_memory', 'procedure'],
    });
    assert.deepStrictEqual(profileFor('causal'), { form_type: 'full', memory_types: null });
    assert.deepStrictEqual(profileFor('policy'), {
      form_type: 'short',
      memory_types: ['decision', 'claim', 'procedure'],
    });
    assert.deepStrictEqual(profileFor('factual'), { form_type: 'short', memory_types: null });
    assert.deepStrictEqual(profileFor('unknown-intent'), { form_type: 'short', memory_types: null });
  });
});
