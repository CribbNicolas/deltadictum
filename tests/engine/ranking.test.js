import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { NEAR_DUPLICATE, USAGE_WEIGHT, applyRedundancy, baseLevel, redundancyPenalty,
  requiredActivation, usageFactors } from '../../src/engine/ranking.js';

describe('required activation', () => {
  test('reviewed authorities keep the base floor', () => {
    assert.equal(requiredActivation({ authority: 'canonical' }, 0.35), 0.35);
    assert.equal(requiredActivation({ authority: 'validated' }, 0.35), 0.35);
  });

  test('unreviewed authorities must clear a higher bar', () => {
    assert.ok(requiredActivation({ authority: 'inferred' }, 0.35) > 0.35);
    assert.ok(requiredActivation({ authority: 'observed' }, 0.35)
      > requiredActivation({ authority: 'inferred' }, 0.35));
  });

  test('an unknown authority is treated as the least trusted, and the floor never exceeds 1', () => {
    assert.equal(requiredActivation({ authority: 'invented' }, 0.35),
      requiredActivation({ authority: 'observed' }, 0.35));
    assert.equal(requiredActivation({ authority: 'observed' }, 0.9), 1);
  });
});

describe('base level activation', () => {
  const now = Date.parse('2026-09-17T00:00:00.000Z');
  const aged = (uses, days) => ({ activation_count: uses,
    created_at: new Date(now - days * 86400000).toISOString() });

  test('never used knowledge has no level', () => {
    assert.equal(baseLevel(aged(0, 30), now), null);
    assert.equal(baseLevel({}, now), null);
  });

  test('more uses raise the level and more age lowers it', () => {
    assert.ok(baseLevel(aged(10, 30), now) > baseLevel(aged(2, 30), now));
    assert.ok(baseLevel(aged(2, 1), now) > baseLevel(aged(2, 300), now));
  });
});

describe('usage factors', () => {
  const now = Date.parse('2026-09-17T00:00:00.000Z');
  const aged = (uses, days) => ({ activation_count: uses,
    created_at: new Date(now - days * 86400000).toISOString() });

  test('a set with no usage history at all is left untouched', () => {
    // No evidence either way must not become a uniform demotion: the eval
    // fixtures and every fresh project land here.
    assert.deepEqual(usageFactors([aged(0, 10), aged(0, 400), {}], now), [1, 1, 1]);
  });

  test('unused knowledge ranks below used knowledge', () => {
    const [used, unused] = usageFactors([aged(5, 10), aged(0, 10)], now);
    assert.ok(used > unused);
    assert.equal(unused, 1 - USAGE_WEIGHT);
  });

  test('the best track record keeps its full value and every factor stays inside the scale', () => {
    const factors = usageFactors([aged(1, 100), aged(50, 10), aged(0, 10)], now);
    assert.equal(Math.max(...factors), 1);
    for (const factor of factors) {
      assert.ok(factor > 0 && factor <= 1, `factor ${factor} left the [0,1] scale`);
    }
  });
});

describe('redundancy', () => {
  test('the first selection is never penalised', () => {
    assert.equal(redundancyPenalty({ trigger: 'when retrying payment requests' }, []), 0);
    assert.equal(applyRedundancy(0.8, 0), 0.8);
  });

  test('a repeated trigger is penalised and an identical one is a near duplicate', () => {
    const trigger = 'when retrying payment requests';
    const penalty = redundancyPenalty({ trigger }, [{ trigger }]);
    assert.equal(penalty, 1);
    assert.ok(penalty >= NEAR_DUPLICATE);
    assert.ok(applyRedundancy(0.8, penalty) < 0.8);
  });

  test('the penalty follows the closest already selected memory, not the average', () => {
    const selected = [{ trigger: 'when packaging desktop assets' }, { trigger: 'when retrying payment requests' }];
    assert.equal(redundancyPenalty({ trigger: 'when retrying payment requests' }, selected), 1);
  });
});
