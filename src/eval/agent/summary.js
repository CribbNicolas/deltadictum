#!/usr/bin/env node
// A trial's headline numbers in the fixed shape the documentation site reads
// (docs/benchmarks/data/*.summary.json), from a report report.js wrote:
//   node src/eval/agent/summary.js --report=output/eval/bench-2026-10-fix/opus.report.json \
//     --id=bench-2026-10-fix-opus --date=2026-10-20 --title="Full benchmark, Claude Opus 5.5" --base=none \
//     --compare=docref,doc,dd2 --judge=claude-opus-5-5 --doc=benchmarks/2026-10-bench-full.md \
//     --caveat="Four projects, 26 tasks; on track, not a promise for yours."
// The site computes the changes against the base; the summary keeps the values.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LABELS = { none: 'Agent alone', docref: 'With documentation', doc: 'With documentation, not referenced',
  dd2: 'With DD', docdd: 'With documentation + DD' };

// Where the report keeps each metric: over all tasks, or over the tasks the project's knowledge bears on.
const METRICS = [
  { id: 'resolution', label: 'Tasks resolved', unit: 'pct', better: 'higher', kind: 'all', key: 'resolution_pct', ci: 'resolution_ci95' },
  { id: 'quality', label: 'Code quality', unit: 'pct', better: 'higher', kind: 'all', key: 'quality_pct', ci: 'quality_ci95' },
  { id: 'requirements', label: "The project's own requirements met", unit: 'pct', better: 'higher', kind: 'memory', key: 'specific_quality_pct', ci: 'specific_quality_ci95' },
  { id: 'context', label: 'Context', unit: 'tokens', better: 'lower', kind: 'all', key: 'median_peak_context_tokens' },
  { id: 'cost', label: 'Cost per task', unit: 'usd', better: 'lower', kind: 'all', key: 'mean_cost_usd' },
];

export function summarize(report, { id, date, title, base, compare, judge, doc, caveat, labels = {} }) {
  const ids = [base, ...compare];
  for (const condition of ids) {
    if (!report.conditions.includes(condition)) throw new Error(`the report has no condition ${condition}; it has ${report.conditions.join(', ')}`);
  }
  const tasks = Object.keys(report.by_task).length;
  const metrics = METRICS.map(({ kind, key, ci, ...metric }) => {
    const values = {}, ci95 = {};
    for (const condition of ids) {
      const group = report.by_kind[kind]?.conditions?.[condition];
      if (typeof group?.[key] !== 'number') throw new Error(`${metric.id} has no value for ${condition}`);
      values[condition] = group[key];
      if (ci && Array.isArray(group[ci])) ci95[condition] = group[ci];
    }
    return { ...metric, values, ...(Object.keys(ci95).length ? { ci95 } : {}) };
  });
  return { schema: 1, id, date, title, model: report.model, tasks,
    runs_per_condition: Math.round(report.by_kind.all.conditions[base].runs / tasks), judge, report: doc, caveat, base,
    conditions: ids.map(condition => ({ id: condition, label: labels[condition] ?? LABELS[condition] ?? condition })), metrics };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
  const report = JSON.parse(await readFile(args.report, 'utf8'));
  const labels = Object.fromEntries((args.labels ?? '').split(',').filter(Boolean).map(pair => pair.split(':')));
  const summary = summarize(report, { ...args, compare: args.compare.split(','), labels });
  const out = args.report.replace(/\.report\.json$/, '.summary.json');
  await writeFile(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${out}`);
}
