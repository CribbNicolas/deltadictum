import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ftsQuery } from '../../../src/engine/v4/fts-query.js';

describe('FTS query builder', () => {
  test('quotes tokens, drops stopwords, and OR-combines column-scoped terms', () => {
    const query = ftsQuery('before writing durable memory');
    assert.equal(
      query,
      '{trigger title topic_key micro short}: "writing" OR {trigger title topic_key micro short}: "durable" OR {trigger title topic_key micro short}: "memory"',
    );
    assert.doesNotMatch(query, /before/);
  });

  test('returns empty when only stopwords remain', () => {
    assert.equal(ftsQuery('before when the'), '');
  });

  test('strips quotes from tokens so MATCH cannot be broken', () => {
    const query = ftsQuery('write "durable" memory');
    assert.match(query, /"durable"/);
    assert.doesNotMatch(query, /""/);
  });
});
