#!/usr/bin/env node
// The full benchmark's totals across models, kept in the repository beside each
// model's summary: headline per condition, the paired comparisons, and every
// cut by project, situation and origin.
//   node src/eval/bench/totals.js --reports=a.report.json,b.report.json --id=bench-2026-10-totals --date=2026-10-20 \
//     --out=docs/benchmarks/data/bench-2026-10-totals.summary.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const slim = cuts => Object.fromEntries(Object.entries(cuts ?? {}).map(([key, cut]) => [key, Object.fromEntries(Object.entries(cut.conditions)
  .map(([condition, g]) => [condition, { runs: g.runs, resolution_pct: g.resolution_pct, specific_quality_pct: g.specific_quality_pct }]))]));

export function totals(reports, { id, date }) {
  return { schema: 1, id, date, models: reports.map(report => ({ model: report.model,
    runs: Object.values(report.by_kind.all.conditions).reduce((n, g) => n + g.runs, 0), tasks: Object.keys(report.by_task).length,
    headline: Object.fromEntries(report.conditions.map(c => {
      const all = report.by_kind.all.conditions[c], memory = report.by_kind.memory.conditions[c];
      return [c, { resolution_pct: all.resolution_pct, specific_quality_pct: memory.specific_quality_pct, mean_cost_usd: all.mean_cost_usd,
        median_peak_context_tokens: all.median_peak_context_tokens }];
    })),
    paired: report.paired, by_project: slim(report.by_project), by_situation: slim(report.by_situation), by_origin: slim(report.by_origin) })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
  const reports = await Promise.all(args.reports.split(',').map(async path => JSON.parse(await readFile(path, 'utf8'))));
  await writeFile(args.out, `${JSON.stringify(totals(reports, args), null, 2)}\n`);
  console.log(`wrote ${args.out}`);
}
