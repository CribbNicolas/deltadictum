import { describe, test } from 'node:test';
import assert from 'node:assert';
import { compareForResolution, recommendResolution, evidenceSupports, bumpPredominance,
  PREDOMINANCE_WIN_BUMP, PREDOMINANCE_CEILING } from '../../../src/engine/v6/predominance.js';

const base = { evidence_supports: 1, valid_from: '2026-01-01T00:00:00Z', authority: 'observed', predominance: 0 };

describe('V6 predominance', () => {
  test('evidence dominates everything', () => {
    const strong = { ...base, evidence_supports: 5, authority: 'observed', predominance: 0 };
    const weak = { ...base, evidence_supports: 1, authority: 'canonical', predominance: 9 };
    assert.strictEqual(compareForResolution(strong, weak), strong);
  });

  test('recency breaks an evidence tie', () => {
    const older = { ...base, evidence_supports: 2, valid_from: '2026-01-01T00:00:00Z' };
    const newer = { ...base, evidence_supports: 2, valid_from: '2026-06-01T00:00:00Z' };
    assert.strictEqual(compareForResolution(older, newer), newer);
  });

  test('authority breaks an evidence+recency tie', () => {
    const a = { ...base, evidence_supports: 2, authority: 'observed' };
    const b = { ...base, evidence_supports: 2, authority: 'canonical' };
    assert.strictEqual(compareForResolution(a, b), b);
  });

  test('predominance is the final tiebreaker only', () => {
    const a = { ...base, evidence_supports: 2, authority: 'validated', predominance: 1 };
    const b = { ...base, evidence_supports: 2, authority: 'validated', predominance: 3 };
    assert.strictEqual(compareForResolution(a, b), b);
  });

  test('exposes a positive win bump', () => {
    assert.ok(PREDOMINANCE_WIN_BUMP > 0);
  });
});

describe('evidence signal', () => {
  test('is derived from verified artifact coverage, so callers need not enrich atoms', () => {
    const covered = { valid_from: '2026-01-01T00:00:00Z', authority: 'observed',
      evidence_state: { verified_count: 3 } };
    const bare = { valid_from: '2026-01-01T00:00:00Z', authority: 'canonical',
      evidence_state: { verified_count: 0 } };
    assert.strictEqual(evidenceSupports(covered), 3);
    assert.strictEqual(evidenceSupports(bare), 0);
    assert.strictEqual(compareForResolution(bare, covered), covered);
  });

  test('an atom with no evidence state contributes nothing rather than failing', () => {
    assert.strictEqual(evidenceSupports({}), 0);
    assert.strictEqual(evidenceSupports(undefined), 0);
  });

  test('an explicitly supplied count wins over the derived one', () => {
    assert.strictEqual(evidenceSupports({ evidence_supports: 7, evidence_state: { verified_count: 1 } }), 7);
  });
});

describe('resolution recommendation', () => {
  const pair = (a, b) => [{ id: 'a', ...base, ...a }, { id: 'b', ...base, ...b }];

  test('names the winner and the tier that decided it', () => {
    assert.deepEqual(recommendResolution(...pair({ evidence_supports: 1 }, { evidence_supports: 4 })),
      { winner_id: 'b', basis: 'evidence', tie: false });
    assert.deepEqual(recommendResolution(...pair({ authority: 'canonical' }, { authority: 'observed' })),
      { winner_id: 'a', basis: 'authority', tie: false });
  });

  test('reports a tie instead of inventing a winner', () => {
    assert.deepEqual(recommendResolution(...pair({}, {})), { winner_id: null, basis: null, tie: true });
  });

  test('agrees with the comparator it advises on', () => {
    const [a, b] = pair({ predominance: 5 }, { predominance: 1 });
    assert.strictEqual(recommendResolution(a, b).winner_id, compareForResolution(a, b).id);
  });
});

describe('predominance bump', () => {
  test('adds the win bump and never falls below the starting value', () => {
    assert.strictEqual(bumpPredominance({ predominance: 1 }), 1 + PREDOMINANCE_WIN_BUMP);
    assert.strictEqual(bumpPredominance({}), PREDOMINANCE_WIN_BUMP);
  });

  test('is bounded, so accumulation cannot turn a tiebreaker into a primary signal', () => {
    assert.strictEqual(bumpPredominance({ predominance: PREDOMINANCE_CEILING }), PREDOMINANCE_CEILING);
  });
});
