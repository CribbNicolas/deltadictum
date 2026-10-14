#!/usr/bin/env node
// The agent trial's numbers, from what run.js and judge.js recorded. Spends
// nothing, so it can be rerun as often as the numbers need checking:
//   node src/eval/agent/report.js --in=quality.json [--conditions=dd,doc,docref]
//
// Per condition, for tasks the project's knowledge bears on, control tasks and all:
// - resolution: the task as asked works (check), the full suite has no
//   regression, lint passes, and the session neither errored nor timed out
//   before its result;
// - quality: the share of the task's requirements met, from its checks and the
//   blind judge: the project-specific ones and the general code quality ones,
//   and the project-specific ones alone;
// - context (peak prompt), time (median session, as its result reports it) and cost (mean per task), each
//   as a percent over the lowest condition, which reads 0.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aboveBest, meanCi, median, parseNumstat, percent, qualityScore, streamMetrics, wilson } from './metrics.js';
import { GENERAL_REQUIREMENTS, TASKS } from './tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const IN = join(REPO, 'output', 'eval', args.in ?? 'agent-results.json');
const OUT = IN.replace(/\.json$/, '') + '.report.json';
const CONDITIONS = (args.conditions ?? 'dd,doc,docref').split(',');
const LABELS = { dd: 'With DD v1', dd2: 'With DD v2', doc: 'Guide, not referenced', docref: 'Guide, referenced in CLAUDE.md', none: 'No project knowledge' };
const GENERAL = new Set(GENERAL_REQUIREMENTS.map(r => r.id));

const results = JSON.parse(await readFile(IN, 'utf8'));
const judge = JSON.parse(await readFile(IN.replace(/\.json$/, '') + '.judge.json', 'utf8').catch(() => 'null'));
const judged = new Map((judge?.judgments ?? []).filter(j => !j.error).map(j => [j.run_id, j.requirements]));

// Memory ids and titles by topic, to follow each task's key memory through DD's
// delivery (v1 names it by id, v2 by title; migration keeps both).
async function memoryIds() {
  const { readdir } = await import('node:fs/promises');
  const ids = new Map();
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else { const atom = JSON.parse(await readFile(join(dir, entry.name), 'utf8')); ids.set(atom.topic_key, { id: atom.id, title: atom.title }); }
    }
  };
  await walk(join(REPO, '.dd', 'atoms'));
  return ids;
}
const ids = await memoryIds();

const rows = [];
for (const row of results.rows) {
  const task = TASKS.find(t => t.id === row.task);
  const stream = await readFile(join(results.runs, `${row.run_id}.jsonl`), 'utf8').catch(() => '');
  const condition = row.condition ?? (row.dd ? 'dd' : 'none');
  const requirements = judged.has(row.run_id) ? { ...row.requirements, ...judged.get(row.run_id) } : null;
  const specific = requirements && Object.fromEntries(Object.entries(requirements).filter(([id]) => !GENERAL.has(id)));
  const metrics = streamMetrics(stream, task.memory ? ids.get(task.memory) : null);
  // A timeout is a session that never reached its result, not a process that outlived it.
  const timedOut = Boolean(row.timed_out && !metrics.finished);
  rows.push({ ...row, condition, ...parseNumstat(row.numstat), ...metrics, timed_out: timedOut,
    lingered: Boolean(row.timed_out && metrics.finished), time_ms: metrics.session_ms ?? row.duration_ms,
    resolved: Boolean(row.passed && row.suite_passed && row.lint_ok === true && !timedOut && !row.error),
    quality: requirements ? qualityScore(requirements) : null,
    specific_quality: specific ? qualityScore(specific) : null });
}

const med = (list, key) => median(list.map(r => r[key]).filter(v => typeof v === 'number'));
const mean = (list, key) => { const v = list.map(r => r[key]).filter(x => typeof x === 'number'); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
function group(list) {
  const resolved = list.filter(r => r.resolved).length;
  const scored = list.filter(r => r.quality !== null), specific = list.filter(r => r.specific_quality !== null);
  const quality = meanCi(scored.map(r => r.quality)), specificQuality = meanCi(specific.map(r => r.specific_quality));
  return {
    runs: list.length,
    resolution_pct: percent(resolved, list.length), resolution_ci95: wilson(resolved, list.length),
    task_check_pct: percent(list.filter(r => r.passed).length, list.length),
    no_regression_pct: percent(list.filter(r => r.suite_passed).length, list.length),
    lint_clean_pct: percent(list.filter(r => r.lint_ok === true).length, list.length),
    lint_unknown: list.filter(r => r.lint_ok === undefined).length,
    quality_runs: scored.length, quality_pct: quality.mean, quality_ci95: quality.ci95,
    specific_quality_runs: specific.length, specific_quality_pct: specificQuality.mean, specific_quality_ci95: specificQuality.ci95,
    median_peak_context_tokens: med(list, 'peak_context_tokens'),
    median_minutes: Number(((med(list, 'time_ms') ?? 0) / 60000).toFixed(2)),
    mean_cost_usd: Number((mean(list, 'cost_usd') ?? 0).toFixed(4)),
    total_cost_usd: Number(list.reduce((n, r) => n + (r.cost_usd ?? 0), 0).toFixed(2)),
    median_tool_calls: med(list, 'tool_calls'), median_lines_changed: med(list, 'lines'),
    timeouts: list.filter(r => r.timed_out).length, lingered: list.filter(r => r.lingered).length, errors: list.filter(r => r.error).length,
    guide_read_pct: percent(list.filter(r => r.guide_reads > 0).length, list.length),
  };
}

const present = CONDITIONS.filter(c => rows.some(r => r.condition === c));
const report = { model: results.model, input: IN, conditions: present, by_kind: {} };
for (const kind of ['memory', 'control', 'all']) {
  const inKind = rows.filter(r => kind === 'all' || r.kind === kind);
  const groups = Object.fromEntries(present.map(c => [c, group(inKind.filter(r => r.condition === c))]));
  const over = key => aboveBest(Object.fromEntries(present.map(c => [c, groups[c][key]])));
  // How each DD version delivered: whether the key memory reached the agent, and what it injected.
  const internals = condition => {
    const withDd = inKind.filter(r => r.condition === condition);
    if (!withDd.length) return null;
    const delivery = withDd.filter(r => r.key_memory);
    const timed = withDd.filter(r => r.latency_before_agent);
    return {
      key_memory_reached_pct: percent(delivery.filter(r => r.key_memory.pushed || r.key_memory.pulled).length, delivery.length),
      median_memories_pushed: med(withDd, 'memories_pushed'), median_injected_tokens: med(withDd, 'injected_tokens'),
      median_hook_ms: med(timed, 'hook_ms'), median_node_ms: med(timed, 'node_ms'),
    };
  };
  report.by_kind[kind] = { conditions: groups,
    above_best_pct: { context: over('median_peak_context_tokens'), time: over('median_minutes'), cost: over('mean_cost_usd') },
    dd_internals: internals('dd'), dd2_internals: internals('dd2') };
}
report.by_task = Object.fromEntries(TASKS.map(task => [task.id, Object.fromEntries(present.map(c => {
  const list = rows.filter(r => r.task === task.id && r.condition === c);
  const q = meanCi(list.filter(r => r.quality !== null).map(r => r.quality));
  return [c, { runs: list.length, resolved: list.filter(r => r.resolved).length, passed: list.filter(r => r.passed).length,
    quality_pct: q.mean, guide_reads: list.filter(r => r.guide_reads > 0).length }];
}))]));

// The table the trial is for, on every task.
const all = report.by_kind.all, memory = report.by_kind.memory;
const cell = (value, ci) => (value === null ? 'n/a' : `${value}%${ci ? ` (${ci[0]}-${ci[1]})` : ''}`);
const lines = [`| | ${present.map(c => LABELS[c]).join(' | ')} |`, `|---|${present.map(() => '---').join('|')}|`,
  `| Resolution | ${present.map(c => cell(all.conditions[c].resolution_pct, all.conditions[c].resolution_ci95)).join(' | ')} |`,
  `| Resolution, tasks the knowledge bears on | ${present.map(c => cell(memory.conditions[c].resolution_pct, memory.conditions[c].resolution_ci95)).join(' | ')} |`,
  `| Code quality | ${present.map(c => cell(all.conditions[c].quality_pct, all.conditions[c].quality_ci95)).join(' | ')} |`,
  `| Project requirements met | ${present.map(c => cell(memory.conditions[c].specific_quality_pct, memory.conditions[c].specific_quality_ci95)).join(' | ')} |`,
  `| Context (0 = least) | ${present.map(c => `+${all.above_best_pct.context[c]}% (${Math.round(all.conditions[c].median_peak_context_tokens / 100) / 10}k)`).join(' | ')} |`,
  `| Time (0 = fastest) | ${present.map(c => `+${all.above_best_pct.time[c]}% (${all.conditions[c].median_minutes} min)`).join(' | ')} |`,
  `| Cost (0 = cheapest) | ${present.map(c => `+${all.above_best_pct.cost[c]}% ($${all.conditions[c].mean_cost_usd})`).join(' | ')} |`];
report.table = lines.join('\n');

await writeFile(OUT, JSON.stringify(report, null, 2));
console.log(report.table);
console.log(`\nfull report: ${OUT}`);
