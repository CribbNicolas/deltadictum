import { describe, test } from 'node:test';
import assert from 'node:assert';
import { compareForResolution, PREDOMINANCE_WIN_BUMP } from '../../../src/engine/v6/predominance.js';

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
