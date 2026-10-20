// Benchmark summaries (docs/benchmarks/data/*.summary.json, schema 1) as the landing's table:
// the change of each condition against the base, over the average of the featured trials.
const UNITS = new Set(['pct', 'tokens', 'usd']);
const BETTER = new Set(['higher', 'lower']);

export function formatValue(value, unit) {
  if (unit === 'pct') return `${Math.round(value)}%`;
  if (unit === 'tokens') return `${(value / 1000).toFixed(1)}k tokens`;
  return `$${value.toFixed(3)}`;
}

// The change is read off the values as shown, so cell and change always agree: a percentage changes by
// points (56% to 99% is +43 pts, never +77%), context and cost by their share of the base.
export function formatChange(value, base, unit, better) {
  const now = shown(value, unit), was = shown(base, unit);
  const judged = delta => (delta === 0 ? null : (better === 'higher') === (delta > 0));
  if (unit === 'pct') return { text: `${now - was < 0 ? '-' : '+'}${Math.abs(now - was)} pts`, better: judged(now - was) };
  if (was === 0) return { text: formatValue(value, unit), better: judged(now) };
  const pct = Math.round(((now - was) / was) * 100) || 0;
  return { text: `${pct < 0 ? '-' : '+'}${Math.abs(pct)}%`, better: judged(pct) };
}

export function validateSummary(summary, name) {
  const fail = message => { throw new Error(`${name}: ${message}`); };
  if (summary?.schema !== 1) fail(`unknown schema ${summary?.schema}`);
  const ids = (summary.conditions ?? []).map(c => c.id);
  if (!ids.length) fail('no conditions');
  if (!ids.includes(summary.base)) fail(`base ${summary.base} is not a condition`);
  for (const key of ['id', 'date', 'title', 'report']) if (typeof summary[key] !== 'string') fail(`no ${key}`);
  if (!summary.metrics?.length) fail('no metrics');
  for (const metric of summary.metrics) {
    if (!UNITS.has(metric.unit)) fail(`${metric.id} has unit ${metric.unit}`);
    if (!BETTER.has(metric.better)) fail(`${metric.id} has better ${metric.better}`);
    for (const id of ids) if (typeof metric.values?.[id] !== 'number' || !Number.isFinite(metric.values[id])) fail(`${metric.id} has no value for ${id}`);
  }
  return summary;
}

// A value at the precision the table shows it, so "level" means level on the page.
function shown(value, unit) {
  if (unit === 'pct') return Math.round(value);
  if (unit === 'tokens') return Math.round(value / 100);
  return Math.round(value * 1000);
}

// Each cell holds its value and, beside it, the change against the base. Each row ranks its columns at the
// precision shown, the base included: the best is first and the next second (a place is one plus the number of
// columns ahead, so columns level at the top share first and leave no second).
export function tableFor(summary) {
  const columns = summary.conditions.map(c => ({ ...c, base: c.id === summary.base }));
  const rows = summary.metrics.map(metric => {
    const base = metric.values[summary.base];
    const score = id => (metric.better === 'higher' ? 1 : -1) * shown(metric.values[id], metric.unit);
    const place = id => 1 + columns.filter(c => score(c.id) > score(id)).length;
    const tone = id => ({ 1: 'first', 2: 'second' })[place(id)] ?? null;
    const cells = columns.map(column => ({ text: formatValue(metric.values[column.id], metric.unit),
      change: column.base ? null : formatChange(metric.values[column.id], base, metric.unit, metric.better).text, tone: tone(column.id) }));
    return { id: metric.id, label: metric.label, cells };
  });
  return { columns, rows };
}

// One summary from several trials of the same tasks: each value is the mean over the trials of the
// mean over the conditions merged into it, every trial and every merged condition weighing the same.
// Intervals do not average, so the result has none.
export function averageSummaries(summaries, { title, note, trials, merge = {} }) {
  const picked = trials.map(id => summaries.find(s => s.id === id) ?? fail(`no benchmark summary ${id}`));
  const [first] = picked;
  for (const other of picked.slice(1)) {
    if (other.tasks !== first.tasks) fail(`${other.id}: ${other.tasks} tasks, ${first.id} has ${first.tasks}`);
    if (other.runs_per_condition !== first.runs_per_condition) fail(`${other.id}: ${other.runs_per_condition} runs per condition, ${first.id} has ${first.runs_per_condition}`);
  }
  const into = Object.fromEntries(Object.entries(merge).flatMap(([id, { of }]) => of.map(member => [member, id])));
  const conditions = [];
  for (const condition of first.conditions) {
    const id = into[condition.id] ?? condition.id;
    if (!conditions.some(c => c.id === id)) conditions.push({ id, label: merge[id]?.label ?? condition.label });
  }
  const mean = list => list.reduce((a, b) => a + b, 0) / list.length;
  const metrics = first.metrics.map(({ ci95, values, ...metric }) => ({ ...metric,
    values: Object.fromEntries(conditions.map(({ id }) => [id, Number(mean(picked.map(trial => {
      const found = trial.metrics.find(m => m.id === metric.id) ?? fail(`${trial.id} has no metric ${metric.id}`);
      return mean((merge[id]?.of ?? [id]).map(member => found.values[member]));
    })).toFixed(4))])) }));
  return { schema: 1, id: trials.join('+'), date: picked.map(s => s.date).sort().at(-1), title, note, models: picked.map(s => s.model),
    tasks: first.tasks, runs_per_condition: first.runs_per_condition, report: first.report, base: first.base, conditions, metrics };
}

function fail(message) { throw new Error(message); }
