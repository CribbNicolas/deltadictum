// Benchmark summaries (docs/benchmarks/data/*.summary.json, schema 1) as tables.
// The landing shows the change of each condition against the base; the Benchmarks
// page shows the values, their 95% intervals and the changes.
const UNITS = new Set(['pct', 'tokens', 'usd']);
const BETTER = new Set(['higher', 'lower']);

export function formatValue(value, unit) {
  if (unit === 'pct') return `${Math.round(value)}%`;
  if (unit === 'tokens') return `${(value / 1000).toFixed(1)}k tokens`;
  return `$${value.toFixed(3)}`;
}

export function formatChange(value, base, unit, better) {
  if (base === 0) return { text: formatValue(value, unit), better: value === 0 ? null : (better === 'higher') === (value > 0) };
  const pct = Math.round(((value - base) / base) * 100) || 0;
  if (pct === 0) return { text: '+0%', better: null };
  return { text: `${pct > 0 ? '+' : '-'}${Math.abs(pct)}%`, better: (better === 'higher') === (pct > 0) };
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

export function tableFor(summary, { detail = false } = {}) {
  const columns = summary.conditions.map(c => ({ ...c, base: c.id === summary.base }));
  const rows = summary.metrics.map(metric => {
    const base = metric.values[summary.base];
    const cells = columns.map(column => {
      const value = metric.values[column.id];
      const change = column.base ? null : formatChange(value, base, metric.unit, metric.better);
      if (!detail) return column.base ? { text: 'Base', value: formatValue(value, metric.unit), better: null } : change;
      const ci = metric.ci95?.[column.id];
      return { text: formatValue(value, metric.unit), ci: ci ? `${Math.round(ci[0])}–${Math.round(ci[1])}` : null,
        change: change?.text ?? null, better: change?.better ?? null };
    });
    return { id: metric.id, label: metric.label, cells };
  });
  return { columns, rows };
}

export function pickFeatured(summaries, id) {
  if (!summaries.length) throw new Error('no benchmark summary in docs/benchmarks/data');
  return summaries.find(s => s.id === id) ?? [...summaries].sort((a, b) => b.date.localeCompare(a.date))[0];
}
