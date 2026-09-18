import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORITY_LADDER, AUTHORITY_RANK, AUTHORITY_WEIGHT, authorityRank } from '../../src/engine/authority.js';
import { AUTHORITY_WEIGHT as RANKING_WEIGHT } from '../../src/engine/ranking.js';

describe('authority ladder', () => {
  test('retrieval weights and resolution ranks agree on every ordering', () => {
    // The two used to live in separate tables. Nothing stopped them disagreeing
    // about which authority outranks which; this is what makes that impossible.
    const names = AUTHORITY_LADDER.map(level => level.name);
    for (const a of names) {
      for (const b of names) {
        assert.equal(Math.sign(AUTHORITY_RANK[a] - AUTHORITY_RANK[b]),
          Math.sign(AUTHORITY_WEIGHT[a] - AUTHORITY_WEIGHT[b]),
          `${a} and ${b} are ordered differently by rank and by weight`);
      }
    }
  });

  test('ranking reads the same weights the ladder defines', () => {
    assert.deepEqual(RANKING_WEIGHT, AUTHORITY_WEIGHT);
  });

  test('covers every authority the store accepts, and only those', () => {
    assert.deepEqual([...AUTHORITY_LADDER.map(l => l.name)].sort(),
      ['canonical', 'deprecated', 'inferred', 'observed', 'validated']);
  });

  test('deprecated carries no weight and sits at the bottom', () => {
    assert.equal(AUTHORITY_WEIGHT.deprecated, 0);
    assert.equal(Math.min(...Object.values(AUTHORITY_RANK)), AUTHORITY_RANK.deprecated);
  });

  test('an unrecognised authority is treated as the least trusted, not as an average', () => {
    assert.equal(authorityRank({ authority: 'invented' }), AUTHORITY_RANK.deprecated);
    assert.equal(authorityRank({}), AUTHORITY_RANK.deprecated);
    assert.equal(authorityRank(undefined), AUTHORITY_RANK.deprecated);
  });
});
