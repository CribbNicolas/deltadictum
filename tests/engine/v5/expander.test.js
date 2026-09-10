import { describe, test } from 'node:test';
import assert from 'node:assert';
import { expandTopicTerms } from '../../../src/engine/v5/expander.js';

describe('V5 topic expander', () => {
  test('returns canonical keys and sibling aliases for alias occurrences', async () => {
    const repository = {
      findAliasOccurrences: async (projectId, text) => {
        assert.strictEqual(text, 'revisar memoria/compactacion en cola');
        return [{ alias: 'memoria/compactacion', registry_id: 'reg-1', canonical_key: 'memory/compaction' }];
      },
      getAliasesForRegistryIds: async ids => {
        assert.deepStrictEqual(ids, ['reg-1']);
        return [
          { registry_id: 'reg-1', alias: 'memoria/compactacion' },
          { registry_id: 'reg-1', alias: 'memory/compactor' },
        ];
      },
    };

    const result = await expandTopicTerms('orquesta', 'Revisar Memoria/Compactación en cola', { repository });
    assert.deepStrictEqual(result.matched, ['memoria/compactacion']);
    assert.deepStrictEqual(result.canonical, ['memory/compaction']);
    assert.deepStrictEqual(
      [...result.terms].sort(),
      ['memoria/compactacion', 'memory/compaction', 'memory/compactor'],
    );
  });

  test('returns empty result when nothing matches or inputs missing', async () => {
    const repository = { findAliasOccurrences: async () => [], getAliasesForRegistryIds: async () => [] };
    assert.deepStrictEqual(await expandTopicTerms('orquesta', 'deploy frontend', { repository }), { matched: [], canonical: [], terms: [] });
    assert.deepStrictEqual(await expandTopicTerms('', 'anything', { repository }), { matched: [], canonical: [], terms: [] });
    assert.deepStrictEqual(await expandTopicTerms('orquesta', '', { repository }), { matched: [], canonical: [], terms: [] });
  });
});
