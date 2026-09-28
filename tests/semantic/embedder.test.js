import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL, configuredModel } from '../../src/semantic/embedder.js';

// The resident's model comes from DD_EMBED_MODEL, by full or short name; anything
// else keeps the default rather than downloading an unmeasured model.
test('DD_EMBED_MODEL picks a supported model and falls back to the default', () => {
  assert.equal(configuredModel({}), DEFAULT_MODEL);
  assert.equal(configuredModel({ DD_EMBED_MODEL: 'multilingual-e5-base' }), 'Xenova/multilingual-e5-base');
  assert.equal(configuredModel({ DD_EMBED_MODEL: 'Xenova/multilingual-e5-base' }), 'Xenova/multilingual-e5-base');
  assert.equal(configuredModel({ DD_EMBED_MODEL: 'some/other-model' }), DEFAULT_MODEL);
});
