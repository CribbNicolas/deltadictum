import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectTasks } from '../../../src/eval/bench/calibrate.js';

const t = (id, situation, kind = 'memory') => ({ id, project: 'p', situation, kind });
const row = (task, passed, requirements = {}, error = null) => ({ task, condition: 'none', passed, requirements, error });

test('memory tasks the agent alone fails are kept; controls always; successes and empty ones dropped', () => {
  const tasks = [t('p-a', 'S1'), t('p-b', 'S1'), t('p-c', 'S11', 'control'), t('p-d', 'S2')];
  const rows = [row('p-a', true, { rule: false }), row('p-a', true, { rule: true }), row('p-b', true, { rule: true }), row('p-b', true),
    row('p-c', true), row('p-d', false, {}, 'boom')];
  const out = selectTasks(rows, tasks);
  assert.deepEqual(out.selected, ['p-a', 'p-c']);
  const reasons = Object.fromEntries(out.candidates.map(c => [c.id, c.reason]));
  assert.deepEqual(reasons, { 'p-a': 'agent_alone_fails', 'p-b': 'agent_alone_succeeds', 'p-c': 'control', 'p-d': 'no_runs' });
  assert.equal(out.candidates.find(c => c.id === 'p-a').failures, 1);
});

test('a full situation keeps the tasks with the most failures', () => {
  const tasks = [t('p-a', 'S1'), t('p-b', 'S1'), t('p-c', 'S1')];
  const rows = [row('p-a', false), row('p-b', false), row('p-b', false), row('p-c', false), row('p-c', false), row('p-c', false)];
  const out = selectTasks(rows, tasks, { perSituation: 2 });
  assert.deepEqual(out.selected, ['p-b', 'p-c']);
  assert.equal(out.candidates.find(c => c.id === 'p-a').reason, 'situation_full');
});
