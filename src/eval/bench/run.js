#!/usr/bin/env node
// The full agent benchmark:
// every task of every registered project, done by Claude Code headless in a fresh
// clone under each knowledge condition, with the task's check, the project's
// suite and lint on the changed tree, and the run's stream and diff kept.
//   dd2     DD's hooks from this checkout, the project's store compiled
//   docref  the same memories as docs/engineering-guide.md, named in CLAUDE.md or AGENTS.md
//   doc     the same guide, nothing points to it
//   none    no .dd/, no guide
//
// This spends real model usage. It runs only when invoked:
//   node src/eval/bench/run.js --model=claude-haiku-5-5 --effort=high --out=bench-2026-10/haiku/results.json
//     [--projects=a,b] [--tasks=a,b] [--selection=path] [--conditions=dd2,docref,doc,none] [--repeat=3]
//     [--conc=1] [--seed=1] [--resume | --fresh] [--recheck=a,b|all] [--check-only] [--no-suite] [--registry=path]
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { limitWait, taskReport, usageLimited } from '../agent/metrics.js';
import { allowedTools } from '../agent/permissions.js';
import { run } from '../agent/proc.js';
import { prepareClone, removeClone } from './clone.js';
import { CONDITIONS as ALL_CONDITIONS, WITH_DD } from './situations.js';
import { assertSubscription } from './billing.js';
import { schedule } from './stats.js';
import { flakyFor, runCommand, suiteOutcome, suiteReverdict } from './suite.js';
import { loadBench, registryAt } from './tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const list = value => (value ? value.split(',') : null);
// --check-only and --recheck run no agent.
if (!('check-only' in args) && !args.recheck) assertSubscription(process.env, args);
const MODEL = args.model ?? 'claude-haiku-5-5';
const EFFORT = args.effort ?? null;
const REPEAT = Number(args.repeat ?? 3);
const SEED = Number(args.seed ?? 1);
const CONDITIONS = list(args.conditions) ?? ALL_CONDITIONS;
if (CONDITIONS.some(c => !ALL_CONDITIONS.includes(c))) throw new Error(`unknown condition in ${args.conditions}`);
const OUT = resolve(REPO, 'output', 'eval', args.out ?? 'bench-results.json');
const ROWS = OUT.replace(/\.json$/, '') + '.rows.jsonl';
// Runs the harness itself failed (a broken setup, a git error): logged, never a row, so --resume runs them again.
const ERRORS = OUT.replace(/\.json$/, '') + '.errors.jsonl';
const RUNS = join(dirname(OUT), 'runs');
const TIMEOUT_MS = 20 * 60 * 1000;
const NO_SUITE = 'no-suite' in args;
// A Node script standing in for claude, for the harness's own test.
const AGENT = process.env.DD_BENCH_AGENT ?? null;
const HOST_ENV = { ...process.env };
delete HOST_ENV.DD_BENCH_AGENT;

const { projects, tasks: ALL } = await loadBench(await registryAt(args.registry));
const selection = args.selection ? new Set(JSON.parse(await readFile(resolve(REPO, args.selection), 'utf8')).selected) : null;
const TASKS = ALL.filter(t => (!list(args.projects) || list(args.projects).includes(t.project))
  && (!list(args.tasks) || list(args.tasks).includes(t.id)) && (!selection || selection.has(t.id)));
const projectOf = task => projects.find(p => p.id === task.project);
const usedProjects = () => projects.filter(p => TASKS.some(t => t.project === p.id));

// The hot path as the host pays it: a fresh hook process per tool call, next to a bare Node start.
async function hookLatency(dir, env, project) {
  const payload = JSON.stringify({ cwd: dir, session_id: 'eval-latency', hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: { file_path: join(dir, project.probeFile) } });
  const time = async (argv, input) => { const t = performance.now(); await run(process.execPath, argv, { cwd: dir, env, input, timeout: 30000 }); return performance.now() - t; };
  const hook = [], node = [];
  for (let i = 0; i < 10; i += 1) {
    hook.push(await time([join(REPO, 'hooks', 'run.cjs'), 'pre-tool'], payload));
    node.push(await time(['-e', '']));
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)];
  return { hook_ms: Math.round(median(hook)), node_ms: Math.round(median(node)) };
}

// The plugin's own registration, anchored at this checkout, as a marketplace install gets it.
async function ddSettings() {
  const { hooks } = JSON.parse(await readFile(join(REPO, 'hooks', 'hooks.json'), 'utf8'));
  return { hooks: JSON.parse(JSON.stringify(hooks).replaceAll('${CLAUDE_PLUGIN_ROOT}', REPO.replaceAll('\\', '/'))) };
}

class UsageLimit extends Error {
  constructor(text) { super(`usage limit: ${text}`); this.wait = limitWait(text); }
}

const gitOut = (dir, ...argv) => execFileSync('git', ['-C', dir, ...argv], { maxBuffer: 64 * 1024 * 1024 }).toString();

async function lintOf(project, dir, env) {
  if (!project.lint) return { lint_ok: null, lint_output: null };
  const out = await runCommand(project.lint, dir, env);
  return { lint_ok: out.ok, lint_output: out.ok ? null : out.out.slice(-1500) };
}

async function suiteIn(project, dir, env) {
  const out = await runCommand(project.suite, dir, env);
  return { passed: out.ok, failed: out.ok ? [] : (project.parseFailures?.(out.out) ?? []) };
}

// The baseline is a fresh clone of the same task and condition: the change may be
// committed, and a stash of nothing cannot be popped.
async function suiteOf(project, task, condition, dir, env, changed) {
  const baseline = async () => {
    const { dir: clean } = await prepareClone(project, task, condition);
    try { return await suiteIn(project, clean, env); } finally { await removeClone(clean, project); }
  };
  return suiteOutcome(() => suiteIn(project, dir, env), baseline, flakyFor(project.knownFlaky, changed));
}

// The paths a recorded patch changes, from its headers.
const patchPaths = patch => [...new Set([...patch.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].flatMap(m => [m[1], m[2]]))];

async function runOnce(task, condition, index) {
  const project = projectOf(task);
  const runId = `${task.id}-${condition}-${index}`;
  const { dir, baseline, store_warnings: storeWarnings, compile_warnings: compileWarnings, index_memories: indexMemories } = await prepareClone(project, task, condition);
  try { return await agentRun(project, task, condition, runId, dir, baseline, storeWarnings, compileWarnings, indexMemories); } finally { await removeClone(dir, project); }
}

async function agentRun(project, task, condition, runId, dir, baseline, storeWarnings, compileWarnings, indexMemories) {
  const env = { ...HOST_ENV, DD_DATA: join(dir, '..', 'dd-data'), DD_MAINTENANCE: '0' };
  // A headless session ends with its answer; a command left running in the background is never read back.
  const prompt = `${task.prompt}

Run every command in the foreground and wait for it to finish before your final answer; give test runs a timeout of up to 10 minutes.`;
  const argv = ['-p', prompt, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '--allowedTools', ...allowedTools(project.programs)];
  if (EFFORT) argv.push('--effort', EFFORT);
  let ddReady = null, latency = {};
  if (WITH_DD.includes(condition)) {
    ddReady = existsSync(join(dir, '.dd', 'local', 'compiled', 'index.json'));
    if (ddReady) latency = await hookLatency(dir, env, project).catch(() => ({}));
    const settings = join(dir, '..', 'dd-settings.json');
    await writeFile(settings, JSON.stringify(await ddSettings()));
    argv.push('--settings', settings);
  }
  const started = Date.now();
  let result, stream = '', timedOut = false;
  try {
    // No shell: it would join the arguments unquoted and split the prompt.
    const out = AGENT ? await run(process.execPath, [AGENT, ...argv], { cwd: dir, env, timeout: TIMEOUT_MS })
      : await run('claude', argv, { cwd: dir, env, timeout: TIMEOUT_MS });
    stream = out.out; timedOut = out.timedOut;
    const events = stream.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
    result = events.findLast(event => event?.type === 'result') ?? { is_error: true, result: timedOut ? 'timeout' : (stream.slice(-2000) + out.err) };
  } catch (err) { result = { is_error: true, result: err.message }; }
  const duration = Date.now() - started;
  if (usageLimited(result)) throw new UsageLimit(String(result.result));
  await writeFile(join(RUNS, `${runId}.jsonl`), stream);
  // The change as a reviewer sees it, against the baseline commit: new files included, DD's own store left
  // out. Commits the agent made are undone into the index (the tree stays), so a check that reads the
  // change against HEAD sees all of it.
  gitOut(dir, 'reset', '-q', '--soft', baseline);
  gitOut(dir, 'add', '-A', '--', '.', ':(exclude).dd');
  const patch = gitOut(dir, 'diff', '--cached', '--binary', baseline);
  const numstat = gitOut(dir, 'diff', '--cached', '--numstat', baseline);
  await writeFile(join(RUNS, `${runId}.diff`), patch);
  // With DD the session's final result is the reply to DD's Stop-hook reminder, not the task report.
  const report = taskReport(stream) ?? String(result.result ?? '');
  const check = await checkOf(task, dir, report);
  // --no-suite: calibration decides on checks alone, so neither the suite nor lint is paid for.
  const lint = NO_SUITE ? { lint_ok: null, lint_output: null } : await lintOf(project, dir, env);
  const suite = NO_SUITE ? { passed: null, first_passed: null, failed_twice: [], regressions: [], baseline_failed: null, baseline_passed: null, flaky: [] }
    : await suiteOf(project, task, condition, dir, env, patchPaths(patch));
  const usage = result.usage ?? {};
  const row = { run_id: runId, task: task.id, project: project.id, situation: task.situation, origin: task.origin, kind: task.kind,
    memories: task.memories, withheld: task.withheld ?? [], condition, base: task.base ?? project.base, model: MODEL, effort: EFFORT, taskset: 'bench',
    dd_ready: ddReady, store_warnings: storeWarnings, compile_warnings: compileWarnings, index_memories: indexMemories,
    passed: check.passed, detail: check.detail, requirements: check.requirements ?? {}, check_error: check.check_error, ...lint,
    suite_passed: suite.passed, suite_skipped: NO_SUITE, suite_first_passed: suite.first_passed, suite_failed_twice: suite.failed_twice, suite_regressions: suite.regressions,
    suite_baseline_failed: suite.baseline_failed, suite_baseline_passed: suite.baseline_passed, suite_flaky: suite.flaky, numstat, ...latency,
    input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output_tokens: usage.output_tokens ?? 0, cost_usd: result.total_cost_usd ?? null, turns: result.num_turns ?? null,
    duration_ms: duration, timed_out: timedOut, answer: report.slice(0, 8000), final_answer: String(result.result ?? '').slice(0, 2000),
    error: result.is_error ? String(result.result).slice(0, 300) : null };
  return row;
}

// A check that throws (a lost connection, a tool missing) has not judged the agent's work: the row
// records a check error, which report.js refuses until --recheck decides the run.
const checkOf = (task, dir, answer) => task.check(dir, answer).then(check => ({ ...check, check_error: null }))
  .catch(err => ({ passed: null, detail: `check_failed: ${err.message}`, requirements: {}, check_error: err.message.slice(0, 300) }));

// The recorded change applied to a fresh baseline, and the task's check and lint again; the suite's
// recorded verdict is judged again against the project's known flaky tests.
async function recheck(row) {
  const task = ALL.find(t => t.id === row.task);
  const project = projectOf(task);
  const { dir } = await prepareClone(project, task, row.condition);
  try {
    const patch = join(RUNS, `${row.run_id}.diff`);
    const text = await readFile(patch, 'utf8');
    if (text.trim()) gitOut(dir, 'apply', '--whitespace=nowarn', patch);
    const check = await checkOf(task, dir, row.answer ?? '');
    return { ...row, passed: check.passed, detail: check.detail, requirements: check.requirements ?? {}, check_error: check.check_error,
      ...await lintOf(project, dir, HOST_ENV), ...suiteReverdict(row, flakyFor(project.knownFlaky, patchPaths(text))),
      rechecked: row.rechecked ?? { passed: row.passed, detail: row.detail, requirements: row.requirements, lint_ok: row.lint_ok,
        suite_passed: row.suite_passed, check_error: row.check_error ?? null } };
  } finally { await removeClone(dir, project); }
}

const resultsFile = rows => ({ model: rows[0]?.model ?? MODEL, effort: rows[0]?.effort ?? EFFORT, taskset: 'bench', repeat: REPEAT, seed: SEED, runs: RUNS, rows });

await mkdir(RUNS, { recursive: true });
for (const project of usedProjects()) {
  for (const base of new Set(TASKS.filter(t => t.project === project.id).map(t => t.base ?? project.base))) await project.setup?.(base);
}

// --check-only runs every task's check on an untouched clone: each must fail, or
// the check passes work that was never done. No agent runs.
if ('check-only' in args) {
  // Checks that pass on an untouched clone, and projects whose suite or lint fails there.
  let passing = 0;
  for (const task of TASKS) {
    const project = projectOf(task);
    const { dir } = await prepareClone(project, task, 'none');
    try {
      const check = await task.check(dir, '').catch(err => ({ passed: false, detail: `check_failed: ${err.message}` }));
      if (check.passed) passing += 1;
      console.log(JSON.stringify({ task: task.id, passed: check.passed, requirements: check.requirements ?? {}, detail: check.detail }));
    } finally { await removeClone(dir, project); }
  }
  // Each condition's clone, as the project's first task would get it; and the project's own suite
  // and lint, which must pass on an untouched tree before any run is paid for.
  for (const project of usedProjects()) {
    const task = TASKS.find(t => t.project === project.id);
    // Every base a task starts from (a mined task starts at its fix's parent), with the first task there.
    const atBase = new Map();
    for (const t of TASKS.filter(t => t.project === project.id)) if (!atBase.has(t.base ?? project.base)) atBase.set(t.base ?? project.base, t);
    for (const [base, first] of atBase) {
      const { dir: clean } = await prepareClone(project, first, 'none');
      try {
        const suite = await suiteIn(project, clean, HOST_ENV);
        const lint = await lintOf(project, clean, HOST_ENV);
        if (!suite.passed || lint.lint_ok === false) passing += 1;
        console.log(JSON.stringify({ project: project.id, base, suite_passes_untouched: suite.passed, lint_ok_untouched: lint.lint_ok, lint_output: lint.lint_output }));
      } finally { await removeClone(clean, project); }
    }
    for (const condition of CONDITIONS) {
      const { dir, base_commit: baseCommit, index_memories: indexMemories, store_warnings: warnings } = await prepareClone(project, task, condition);
      try {
        const guide = await readFile(join(dir, 'docs', 'engineering-guide.md'), 'utf8').catch(() => null);
        const target = await readFile(join(dir, project.guideTarget), 'utf8').catch(() => '');
        // No commit up to the base may name DD's store: an agent would read it with git log -p.
        const historyClean = !/^\.dd\//m.test(gitOut(dir, 'log', '--name-only', '--format=', baseCommit));
        if (!historyClean) passing += 1;
        console.log(JSON.stringify({ project: project.id, condition, dd_dir: existsSync(join(dir, '.dd')), guide_sections: guide ? (guide.match(/^### /gm) ?? []).length : null,
          target_names_guide: /engineering-guide/.test(target), index_memories: indexMemories, store_warnings: warnings, history_clean: historyClean }));
      } finally { await removeClone(dir, project); }
    }
  }
  process.exit(passing ? 1 : 0);
}

if (args.recheck) {
  const only = list(args.recheck);
  const rows = (await readFile(ROWS, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const [i, row] of rows.entries()) {
    if (!(only.includes('all') || only.includes(row.task)) || usageLimited(row.error ?? '')) continue;
    rows[i] = await recheck(row);
    console.log(JSON.stringify({ run_id: row.run_id, was: row.passed, passed: rows[i].passed, detail: rows[i].detail }));
  }
  await writeFile(ROWS, rows.map(row => `${JSON.stringify(row)}\n`).join(''));
  await writeFile(OUT, JSON.stringify(resultsFile(rows), null, 2));
  process.exit(0);
}

const done = new Set();
if ('resume' in args) {
  // Rows a usage limit cut short are dropped and run again.
  const kept = (await readFile(ROWS, 'utf8').catch(() => '')).split('\n').filter(Boolean).filter(line => !usageLimited(JSON.parse(line).error ?? ''));
  await writeFile(ROWS, kept.map(line => `${line}\n`).join(''));
  for (const line of kept) done.add(JSON.parse(line).run_id);
} else if ((await readFile(ROWS, 'utf8').catch(() => '')).trim() && !('fresh' in args)) {
  throw new Error(`rows_exist: ${ROWS} holds recorded runs; pass --resume to continue them or --fresh to discard them`);
} else await rm(ROWS, { force: true });
const jobs = schedule(TASKS, CONDITIONS, REPEAT, done, SEED);
// --conc=N overlaps runs: each has its own clone and data directory.
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    let row;
    try { row = await runOnce(...job); } catch (err) {
      if (!(err instanceof UsageLimit)) {
        const runId = `${job[0].id}-${job[1]}-${job[2]}`;
        await appendFile(ERRORS, JSON.stringify({ run_id: runId, at: new Date().toISOString(), error: String(err.stack ?? err).slice(0, 2000) }) + '\n');
        console.log(JSON.stringify({ run_id: runId, harness_error: err.message }));
        continue;
      }
      console.log(JSON.stringify({ run_id: `${job[0].id}-${job[1]}-${job[2]}`, waiting_minutes: Math.round(err.wait / 60000), error: err.message }));
      jobs.unshift(job);
      await new Promise(r => setTimeout(r, err.wait));
      continue;
    }
    await appendFile(ROWS, JSON.stringify(row) + '\n');
    console.log(JSON.stringify({ run_id: row.run_id, passed: row.passed, suite_passed: row.suite_passed, dd_ready: row.dd_ready,
      lint_ok: row.lint_ok, cost_usd: row.cost_usd, minutes: Number((row.duration_ms / 60000).toFixed(1)), error: row.error }));
  }
}
await Promise.all(Array.from({ length: Number(args.conc ?? 1) }, worker));
const rows = (await readFile(ROWS, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
await writeFile(OUT, JSON.stringify(resultsFile(rows), null, 2));
console.log(JSON.stringify({ model: MODEL, effort: EFFORT, runs: rows.length, report: OUT }, null, 2));
