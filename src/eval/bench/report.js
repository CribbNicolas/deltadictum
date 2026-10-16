#!/usr/bin/env node
// The full benchmark's numbers, from what run.js and judge.js recorded. Spends
// nothing. Per condition and per cut (task kind, project, situation, origin):
// resolution, quality, the project's own requirements, context, time, cost and,
// for dd2, when the key memories arrived and what else came with them; and dd2
// paired with each other condition by task, with bootstrap intervals over tasks.
//   node src/eval/bench/report.js --in=bench-2026-10/haiku/results.json [--registry=path]
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aboveBest, meanCi, median, parseNumstat, percent, qualityScore, streamMetrics, wilson } from '../agent/metrics.js';
import { GENERAL_REQUIREMENTS } from '../agent/tasks.js';
import { deliveries, listed } from './delivery.js';
import { bootstrapMean, pairedDiffs } from './stats.js';

const GENERAL = new Set(GENERAL_REQUIREMENTS.map(r => r.id));
const TIMING = ['before_edit', 'at_edit', 'after_edit', 'no_edit'];
const LABELS = { dd2: 'With DD v2', docref: 'Guide, referenced', doc: 'Guide, not referenced', none: 'No project knowledge' };

// requireJudge: a judge ran over these results, so a run it did not decide is left out of quality.
export function enrichRow(row, task, stream, judgedRequirements, titleOf, { requireJudge = false, titles = [] } = {}) {
  const metrics = streamMetrics(stream, null);
  const keyTitles = (task.memories ?? []).map(topic => titleOf(task.project, topic)).filter(Boolean);
  const withheldTitles = (task.withheld ?? []).map(topic => titleOf(task.project, topic)).filter(Boolean);
  // Titles with " - " in them are read whole when the store knows them.
  const delivered = deliveries(stream, [...keyTitles, ...withheldTitles, ...titles]);
  const byTitle = new Map(delivered.map(d => [d.title, d]));
  const requirements = judgedRequirements ? { ...row.requirements, ...judgedRequirements } : { ...row.requirements };
  const specific = Object.fromEntries(Object.entries(requirements).filter(([id]) => !GENERAL.has(id)));
  const specificValues = Object.values(specific).filter(v => typeof v === 'boolean');
  const keysDelivered = keyTitles.length ? keyTitles.every(title => byTitle.has(title)) : null;
  // The latest arrival among the keys: a task needing two memories is served when the second arrives.
  const keyAt = keysDelivered ? keyTitles.map(title => byTitle.get(title).at).sort((a, b) => TIMING.indexOf(b) - TIMING.indexOf(a))[0] : null;
  const timedOut = Boolean(row.timed_out && !metrics.finished);
  const unjudged = requireJudge && !judgedRequirements;
  return { ...row, ...parseNumstat(row.numstat), tool_calls: metrics.tool_calls, peak_context_tokens: metrics.peak_context_tokens,
    injected_tokens: metrics.injected_tokens, guide_reads: metrics.guide_reads, time_ms: metrics.session_ms ?? row.duration_ms, timed_out: timedOut,
    // A project without lint (lint_ok null) is not held against the run.
    resolved: Boolean(row.passed && row.suite_passed && row.lint_ok !== false && !timedOut && !row.error),
    unjudged, quality: unjudged ? null : qualityScore(requirements), specific_quality: unjudged ? null : qualityScore(specific),
    keys_delivered: keysDelivered, key_at: keyAt,
    applied: keysDelivered && specificValues.length && !unjudged ? specificValues.every(Boolean) : null,
    withheld_ok: withheldTitles.length ? !withheldTitles.some(title => byTitle.has(title)) : null,
    noise: delivered.filter(d => !keyTitles.includes(d.title)).length, listed: listed(stream).length };
}

const nums = (rows, key) => rows.map(r => r[key]).filter(v => typeof v === 'number');
const med = (rows, key) => median(nums(rows, key));
const share = (rows, key) => { const decided = rows.filter(r => typeof r[key] === 'boolean'); return percent(decided.filter(r => r[key]).length, decided.length); };

export function group(rows) {
  const resolved = rows.filter(r => r.resolved).length;
  const quality = meanCi(nums(rows, 'quality')), specific = meanCi(nums(rows, 'specific_quality'));
  const costs = nums(rows, 'cost_usd');
  return { runs: rows.length,
    resolution_pct: percent(resolved, rows.length), resolution_ci95: wilson(resolved, rows.length),
    quality_pct: quality.mean, quality_ci95: quality.ci95, specific_quality_pct: specific.mean, specific_quality_ci95: specific.ci95,
    median_peak_context_tokens: med(rows, 'peak_context_tokens'),
    median_minutes: Number(((med(rows, 'time_ms') ?? 0) / 60000).toFixed(2)),
    mean_cost_usd: costs.length ? Number((costs.reduce((a, b) => a + b, 0) / costs.length).toFixed(4)) : null,
    total_cost_usd: Number(costs.reduce((a, b) => a + b, 0).toFixed(2)),
    median_tool_calls: med(rows, 'tool_calls'), unjudged: rows.filter(r => r.unjudged).length, timeouts: rows.filter(r => r.timed_out).length, errors: rows.filter(r => r.error).length,
    guide_read_pct: percent(rows.filter(r => r.guide_reads > 0).length, rows.length),
    keys_delivered_pct: share(rows, 'keys_delivered'),
    key_at: Object.fromEntries(TIMING.map(t => [t, rows.filter(r => r.key_at === t).length])),
    applied_pct: share(rows, 'applied'), withheld_ok_pct: share(rows, 'withheld_ok'),
    median_noise: med(rows, 'noise'), median_injected_tokens: med(rows, 'injected_tokens'),
    median_hook_ms: med(rows, 'hook_ms'), median_node_ms: med(rows, 'node_ms') };
}

function cut(rows, conditions) {
  const groups = Object.fromEntries(conditions.map(c => [c, group(rows.filter(r => r.condition === c))]));
  const over = key => aboveBest(Object.fromEntries(conditions.map(c => [c, groups[c][key]])));
  return { conditions: groups, above_best_pct: { context: over('median_peak_context_tokens'), time: over('median_minutes'), cost: over('mean_cost_usd') } };
}
const cutsBy = (rows, conditions, key) => Object.fromEntries([...new Set(rows.map(r => r[key]))].sort()
  .map(value => [value, cut(rows.filter(r => r[key] === value), conditions)]));

const PAIRED = {
  requirements: { kind: 'memory', value: r => r.specific_quality },
  resolution: { kind: 'all', value: r => (r.resolved ? 1 : 0) },
  cost_usd: { kind: 'all', value: r => r.cost_usd },
  peak_context_tokens: { kind: 'all', value: r => r.peak_context_tokens },
};

export function buildReport(rows, conditions, model) {
  const present = conditions.filter(c => rows.some(r => r.condition === c));
  const report = { model, conditions: present,
    by_kind: Object.fromEntries(['memory', 'control', 'all'].map(kind => [kind, cut(rows.filter(r => kind === 'all' || r.kind === kind), present)])),
    by_project: cutsBy(rows, present, 'project'), by_situation: cutsBy(rows, present, 'situation'), by_origin: cutsBy(rows, present, 'origin'),
    by_task: Object.fromEntries([...new Set(rows.map(r => r.task))].sort().map(id => [id, Object.fromEntries(present.map(c => {
      const list = rows.filter(r => r.task === id && r.condition === c);
      return [c, { runs: list.length, resolved: list.filter(r => r.resolved).length, specific_quality_pct: meanCi(nums(list, 'specific_quality')).mean }];
    }))])),
    paired: {} };
  for (const [metric, { kind, value }] of Object.entries(PAIRED)) {
    const inKind = rows.filter(r => kind === 'all' || r.kind === kind);
    report.paired[metric] = Object.fromEntries(present.filter(c => c !== 'dd2' && present.includes('dd2'))
      .map(other => [other, bootstrapMean(pairedDiffs(inKind, 'dd2', other, value))]));
  }
  const all = report.by_kind.all, memory = report.by_kind.memory;
  const cell = (v, ci) => (v === null || v === undefined ? 'n/a' : `${v}%${ci ? ` (${ci[0]}-${ci[1]})` : ''}`);
  report.table = [`| | ${present.map(c => LABELS[c] ?? c).join(' | ')} |`, `|---|${present.map(() => '---').join('|')}|`,
    `| Resolution | ${present.map(c => cell(all.conditions[c].resolution_pct, all.conditions[c].resolution_ci95)).join(' | ')} |`,
    `| Code quality | ${present.map(c => cell(all.conditions[c].quality_pct, all.conditions[c].quality_ci95)).join(' | ')} |`,
    `| Project requirements met | ${present.map(c => cell(memory.conditions[c].specific_quality_pct, memory.conditions[c].specific_quality_ci95)).join(' | ')} |`,
    `| Context (0 = least) | ${present.map(c => `+${all.above_best_pct.context[c]}% (${Math.round((all.conditions[c].median_peak_context_tokens ?? 0) / 100) / 10}k)`).join(' | ')} |`,
    `| Time (0 = fastest) | ${present.map(c => `+${all.above_best_pct.time[c]}% (${all.conditions[c].median_minutes} min)`).join(' | ')} |`,
    `| Cost (0 = cheapest) | ${present.map(c => `+${all.above_best_pct.cost[c]}% ($${all.conditions[c].mean_cost_usd})`).join(' | ')} |`].join('\n');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
  const IN = resolve(REPO, 'output', 'eval', args.in);
  const results = JSON.parse(await readFile(IN, 'utf8'));
  const judge = JSON.parse(await readFile(IN.replace(/\.json$/, '') + '.judge.json', 'utf8').catch(() => 'null'));
  const judged = new Map((judge?.judgments ?? []).filter(j => !j.error).map(j => [j.run_id, j.requirements]));
  const { loadBench, registryAt } = await import('./tasks.js');
  const { projects, tasks } = await loadBench(await registryAt(args.registry));
  // A topic can recur across statuses in a real store: a live memory's title first.
  const titleOf = (projectId, topic) => { const all = projects.find(p => p.id === projectId)?.memories.filter(m => m.topic === topic) ?? []; return (all.find(m => ['active', 'contested'].includes(m.status ?? 'active')) ?? all[0])?.title ?? null; };
  const rows = [];
  for (const row of results.rows) {
    const task = tasks.find(t => t.id === row.task);
    const stream = await readFile(join(results.runs, `${row.run_id}.jsonl`), 'utf8').catch(() => '');
    const titles = projects.find(p => p.id === row.project)?.memories.map(m => m.title) ?? [];
    rows.push(enrichRow(row, task, stream, judged.get(row.run_id) ?? null, titleOf, { requireJudge: Boolean(judge), titles }));
  }
  const report = { input: IN, ...buildReport(rows, ['dd2', 'docref', 'doc', 'none'], results.model) };
  await writeFile(IN.replace(/\.json$/, '') + '.report.json', JSON.stringify(report, null, 2));
  console.log(report.table);
}
