import { median } from '../agent/metrics.js';

// The delivery header and the `[KIND] Title - ` prefix each delivered memory carries.
const ENVELOPE_TOKENS = 12;
const HUB_RATE = 0.3;
const LIVE = ['active', 'contested'];
const tokens = text => Math.ceil(String(text ?? '').length / 4);
const p90 = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] : null;
};

export function benchMetrics(fixture, results, memories) {
  const byId = new Map(memories.map(m => [m.id, m]));
  const byTopic = new Map(memories.map(m => [m.topic, m.id]));
  const runs = new Map(fixture.runs.map(run => [run.run_id, run]));
  const rows = results.map(result => {
    const run = runs.get(result.run_id);
    const task = fixture.tasks[result.task];
    const key = task.memory ? byTopic.get(task.memory) ?? null : null;
    const firstEdit = run.events.findIndex(e => e.kind === 'edit' || e.kind === 'write');
    const keyHit = key ? result.delivered.get(key) : null;
    return {
      run_id: result.run_id, task: result.task, condition: result.condition, kind: task.kind, key,
      key_delivered: Boolean(keyHit),
      // Context added at the first edit arrives with that edit's result, after it applied.
      key_before_edit: Boolean(keyHit) && (firstEdit < 0 || keyHit.at < firstEdit),
      noise: result.delivered.size - (keyHit ? 1 : 0),
      tokens: [...result.delivered.keys()].reduce((n, id) => n + tokens(byId.get(id)?.body) + ENVELOPE_TOKENS, 0),
      via: [...result.delivered.values()].map(d => d.via.join('+')),
      delivered: [...result.delivered.keys()],
    };
  });
  const memoryRows = rows.filter(row => row.kind === 'memory');
  const fired = new Map();
  for (const row of rows) for (const id of row.delivered) fired.set(id, (fired.get(id) ?? 0) + 1);
  const byDimension = {};
  for (const row of rows) for (const via of row.via) byDimension[via] = (byDimension[via] ?? 0) + 1;
  const live = memories.filter(m => LIVE.includes(m.status));
  const summary = {
    runs: rows.length,
    memory_runs: memoryRows.length,
    key_delivered: memoryRows.filter(row => row.key_delivered).length,
    key_before_edit: memoryRows.filter(row => row.key_before_edit).length,
    missed: memoryRows.filter(row => !row.key_delivered).map(row => row.run_id),
    median_noise_memory_tasks: median(memoryRows.map(row => row.noise)),
    median_noise_control_tasks: median(rows.filter(row => row.kind === 'control').map(row => row.noise)),
    median_tokens: median(rows.map(row => row.tokens)),
    p90_tokens: p90(rows.map(row => row.tokens)),
    zero_token_runs: rows.filter(row => row.tokens === 0).length,
    deliveries_by_dimension: byDimension,
    hubs: [...fired].filter(([, n]) => n / rows.length > HUB_RATE)
      .map(([id, n]) => ({ topic: byId.get(id)?.topic ?? id, rate: Math.round((n / rows.length) * 100) }))
      .sort((a, b) => b.rate - a.rate),
    top_firing: [...fired].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => ({ topic: byId.get(id)?.topic ?? id, runs: n })),
    never_fired: live.filter(m => !fired.has(m.id)).map(m => m.topic),
    without_triggers: live.filter(m => !(m.triggers ?? []).length).map(m => m.topic),
  };
  return { summary, rows };
}
