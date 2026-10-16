#!/usr/bin/env node
// Calibration (spec, validity rule 4): each candidate ran three times in `none`
// with Haiku; a memory task stays when the agent alone failed it at least once,
// so the benchmark measures where the knowledge matters. The list, with every
// candidate's result, is committed before the full run.
//   node src/eval/bench/calibrate.js --in=bench-2026-10/calibration/results.json --out=docs/benchmarks/data/bench-2026-10-calibration.json
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const failed = row => !row.passed || Object.values(row.requirements ?? {}).some(v => v === false);

export function selectTasks(rows, tasks, { perSituation = 4 } = {}) {
  const candidates = tasks.map(task => {
    const counted = rows.filter(r => r.task === task.id && !r.error);
    const failures = counted.filter(failed).length;
    const reason = task.kind === 'control' ? 'control' : !counted.length ? 'no_runs' : failures ? 'agent_alone_fails' : 'agent_alone_succeeds';
    return { id: task.id, project: task.project, situation: task.situation, kind: task.kind, runs: counted.length, failures,
      kept: reason === 'control' || reason === 'agent_alone_fails', reason };
  });
  const bySituation = new Map();
  for (const c of candidates.filter(c => c.kept && c.kind === 'memory')) bySituation.set(c.situation, [...(bySituation.get(c.situation) ?? []), c]);
  for (const group of bySituation.values()) {
    group.sort((a, b) => b.failures - a.failures || a.id.localeCompare(b.id));
    for (const c of group.slice(perSituation)) Object.assign(c, { kept: false, reason: 'situation_full' });
  }
  return { selected: candidates.filter(c => c.kept).map(c => c.id).sort(), candidates };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
  const results = JSON.parse(await readFile(resolve(REPO, 'output', 'eval', args.in), 'utf8'));
  const { loadBench, registryAt } = await import('./tasks.js');
  const { tasks } = await loadBench(await registryAt(args.registry));
  const out = selectTasks(results.rows.filter(r => r.condition === 'none'), tasks, { perSituation: Number(args.per ?? 4) });
  await writeFile(resolve(REPO, args.out), `${JSON.stringify({ schema: 1, model: results.model, ...out }, null, 2)}\n`);
  console.log(JSON.stringify({ selected: out.selected.length, candidates: out.candidates.length, out: args.out }));
}
