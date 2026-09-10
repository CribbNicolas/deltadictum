import { describe, test } from 'node:test';
import assert from 'node:assert';
import { normalizeKey, validateKeyFormat, domainOf, validateAgainstVocabulary } from '../../../src/engine/v5/vocab.js';

describe('V5 vocab', () => {
  test('normalizeKey lowercases, trims, strips accents', () => {
    assert.strictEqual(normalizeKey('  Memoria/Compactación  '), 'memoria/compactacion');
  });

  test('validateKeyFormat accepts lowercase slash-path depth 2-4', () => {
    assert.strictEqual(validateKeyFormat('memory/compaction').valid, true);
    assert.strictEqual(validateKeyFormat('memory/compaction/non_empty_raw/extra').valid, true);
  });

  test('validateKeyFormat rejects depth 1, depth 5, bad chars, empty', () => {
    assert.deepStrictEqual(validateKeyFormat('memory'), { valid: false, reason: 'invalid_key_format' });
    assert.deepStrictEqual(validateKeyFormat('a/b/c/d/e'), { valid: false, reason: 'invalid_key_format' });
    assert.deepStrictEqual(validateKeyFormat('memory/Compac tion'), { valid: false, reason: 'invalid_key_format' });
    assert.deepStrictEqual(validateKeyFormat(''), { valid: false, reason: 'empty_key' });
  });

  test('domainOf returns first segment', () => {
    assert.strictEqual(domainOf('Memory/Compaction'), 'memory');
  });

  test('validateAgainstVocabulary enforces domain and tag vocabularies', () => {
    const vocab = { domains: ['memory', 'queue'], tags: ['infra', 'testing'] };
    assert.strictEqual(validateAgainstVocabulary('memory/compaction', ['infra'], vocab).valid, true);
    assert.deepStrictEqual(
      validateAgainstVocabulary('agents/routing', [], vocab),
      { valid: false, reason: 'unknown_domain' },
    );
    assert.deepStrictEqual(
      validateAgainstVocabulary('memory/compaction', ['nope'], vocab),
      { valid: false, reason: 'unknown_tag', tag: 'nope' },
    );
  });
});
