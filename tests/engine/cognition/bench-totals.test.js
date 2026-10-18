import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totals } from '../../../src/eval/bench/totals.js';

const g = (q, r, runs = 4) => ({ runs, specific_quality_pct: q, resolution_pct: r, mean_cost_usd: 0.1, median_peak_context_tokens: 1000 });
const report = model => ({ model, conditions: ['dd2', 'none'],
  by_kind: { all: { conditions: { dd2: g(90, 100, 8), none: g(60, 90, 8) } }, memory: { conditions: { dd2: g(90, 100), none: g(60, 90) } } },
  by_project: { p: { conditions: { dd2: g(90, 100), none: g(60, 90) } } }, by_situation: { S1: { conditions: { dd2: g(90, 100), none: g(60, 90) } } },
  by_origin: { invented: { conditions: { dd2: g(90, 100), none: g(60, 90) } } }, by_task: { a: {}, b: {} },
  paired: { requirements: { none: { n: 2, mean: 0.3, ci95: [0.1, 0.5] } } } });

test('totals keep each model\'s headline, paired results and cuts', () => {
  const out = totals([report('opus'), report('haiku')], { id: 'bench-2026-10-totals', date: '2026-10-20' });
  assert.equal(out.schema, 1);
  assert.deepEqual(out.models.map(m => m.model), ['opus', 'haiku']);
  assert.equal(out.models[0].runs, 16);
  assert.equal(out.models[0].tasks, 2);
  assert.equal(out.models[0].headline.dd2.specific_quality_pct, 90);
  assert.equal(out.models[0].headline.none.resolution_pct, 90);
  assert.equal(out.models[1].by_situation.S1.none.specific_quality_pct, 60);
  assert.equal(out.models[1].paired.requirements.none.mean, 0.3);
});
