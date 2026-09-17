import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReplay } from '../../../src/eval/replay.js';

test('behavioral replay covers paraphrases, changed context and abstention within budget', async () => {
  const report = await runReplay();
  assert.ok(report.f1 >= 0.9, JSON.stringify(report.rows.filter(r => !r.correct)));
  assert.equal(report.exact, report.cases, JSON.stringify(report.rows.filter(r => !r.correct)));
  assert.ok(report.estimated_tokens.dd < report.estimated_tokens.static_instructions);
  assert.ok(report.rows.every(r => r.tokens <= 600));
});
