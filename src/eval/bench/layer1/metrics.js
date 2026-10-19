// What layer 1 measures per mutation and condition: a task's key memories delivered (all of them),
// before the first edit or write, and the memories delivered besides. A live memory with no trigger
// (a check-only one) cannot fire in a replay: it is listed and left out of the keys.
import { median, percent } from '../../agent/metrics.js';

const LIVE = ['active', 'contested'];
const mutationOf = runId => (String(runId).includes('~') ? String(runId).slice(String(runId).lastIndexOf('~') + 1) : 'none');

export function layer1Summary(fixture, results, memories) {
  const live = memories.filter(m => LIVE.includes(m.status ?? 'active'));
  const untriggered = live.filter(m => !(m.triggers ?? []).length).map(m => m.topic).sort();
  const silent = new Set(untriggered);
  const byTopic = new Map(live.map(m => [m.topic, m.id]));
  const runs = new Map(fixture.runs.map(run => [run.run_id, run]));
  const groups = {};
  for (const result of results) {
    const run = runs.get(result.run_id);
    const task = fixture.tasks[result.task] ?? { kind: 'control', memories: [] };
    const keys = task.kind === 'memory' ? task.memories.filter(topic => !silent.has(topic)).map(topic => byTopic.get(topic) ?? `missing:${topic}`) : [];
    const firstChange = run.events.findIndex(e => e.kind === 'edit' || e.kind === 'write');
    const hits = keys.map(id => result.delivered.get(id)).filter(Boolean);
    const group = ((groups[mutationOf(result.run_id)] ??= {})[result.condition] ??= []);
    group.push({
      key_run: keys.length > 0,
      delivered: keys.length > 0 && hits.length === keys.length,
      // Context added at the first edit arrives with that edit's result, after it applied.
      before_edit: keys.length > 0 && hits.length === keys.length && hits.every(hit => firstChange < 0 || hit.at < firstChange),
      partial: hits.length > 0 && hits.length < keys.length,
      noise: [...result.delivered.keys()].filter(id => !keys.includes(id)).length,
    });
  }
  const summarize = rows => {
    const keyRuns = rows.filter(row => row.key_run);
    return { runs: rows.length, key_runs: keyRuns.length, keys_delivered_pct: percent(keyRuns.filter(row => row.delivered).length, keyRuns.length),
      keys_before_edit_pct: percent(keyRuns.filter(row => row.before_edit).length, keyRuns.length), keys_partial: rows.filter(row => row.partial).length,
      median_noise: median(rows.map(row => row.noise)), untriggered };
  };
  return Object.fromEntries(Object.keys(groups).sort().map(mutation => [mutation,
    Object.fromEntries(Object.keys(groups[mutation]).sort().map(condition => [condition, summarize(groups[mutation][condition])]))]));
}
