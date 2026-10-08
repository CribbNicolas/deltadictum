#!/usr/bin/env node
// Agent-level evaluation (phase 6): the same task, done by a real coding agent
// under different ways of holding the project's knowledge, compared on outcome,
// quality and what it cost. Each condition gets the knowledge through one
// channel only:
//   dd      DD's store, hooks and MCP server
//   doc     the same knowledge as one document, docs/engineering-guide.md
//           (src/eval/agent/guide.js), which nothing points to
//   docref  that document, named in CLAUDE.md
//   none    no project knowledge (no .dd/, no guide)
//
// Each run gets a fresh clone of the current commit. Claude Code runs headless
// with only project settings: no user plugins, hooks or MCP servers. The DD
// condition adds DD's hooks and MCP server explicitly and starts the resident
// process first, so the first prompt already gets semantic retrieval. The
// agent's own memory is keyed by directory, so every clone starts empty.
//
// Each run keeps its raw material under output/eval/<runs>/: the agent's event
// stream with hook events (<run>.jsonl) and its change (<run>.diff). Rows are
// appended to <out>.rows.jsonl as they finish, so --resume continues a stopped
// trial. src/eval/agent/report.js turns them into the numbers.
//
// This spends real model usage. It runs only when invoked:
//   node src/eval/agent/run.js [--model=claude-sonnet-5-5] [--repeat=2] [--tasks=a,b] [--conditions=dd,doc,docref]
//     [--out=name.json] [--runs=dir] [--conc=1] [--resume]
//   node src/eval/agent/run.js --out=name.json --runs=dir --recheck=a,b|all
import { spawn, execFileSync } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { engineeringGuide } from './guide.js';
import { limitWait, taskReport, usageLimited } from './metrics.js';
import { killTree, run as runProcess } from './proc.js';
import { TASKS } from './tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const MODEL = args.model ?? 'claude-sonnet-5-5';
const REPEAT = Number(args.repeat ?? 2);
const ONLY = args.tasks ? args.tasks.split(',') : null;
// --prune=a,b removes those memories (id prefixes) from the DD clone, to measure
// a store without them.
const PRUNE = args.prune ? args.prune.split(',') : [];
const CONDITIONS = (args.conditions ?? 'dd,doc,docref').split(',');
if (CONDITIONS.some(c => !['dd', 'none', 'doc', 'docref'].includes(c))) throw new Error(`unknown condition in ${args.conditions}`);
const TIMEOUT_MS = 20 * 60 * 1000;
const SUITE_TIMEOUT_MS = 10 * 60 * 1000;
const LINT_TIMEOUT_MS = 5 * 60 * 1000;
const ALLOWED = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git:*)', 'mcp__dd'];
const OUT = join(REPO, 'output', 'eval', args.out ?? 'agent-results.json');
const ROWS = OUT.replace(/\.json$/, '') + '.rows.jsonl';
const RUNS = join(REPO, 'output', 'eval', args.runs ?? 'runs');
// --recheck=a,b (or all) runs those tasks' checks and lint again on the recorded changes, after a
// fix to a check; no agent runs.
const RECHECK = args.recheck ? args.recheck.split(',') : null;

// Checks run in this process. Without these, the MCP retrieve a check calls is
// answered by the machine's resident with its own code, which lacks the agent's
// change (retrieve-title failed 4/4 that way), or refused for want of one.
// Agents get their environment from HOST_ENV.
const HOST_ENV = { ...process.env };
Object.assign(process.env, { DD_RESIDENT: '0', DD_RETRIEVAL: 'lexical',
  DD_RESIDENT_REGISTRY: join(tmpdir(), `dd-eval-checks-${process.pid}.json`) });

const run = (command, argv, { timeout = TIMEOUT_MS, ...options } = {}) => runProcess(command, argv, { timeout, ...options });

const git = (dir, ...argv) => execFileSync('git', ['-C', dir, ...argv], { maxBuffer: 64 * 1024 * 1024 }).toString();
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };

// The hot path as the host pays it: a fresh hook process per tool call, against
// the warm resident, next to a bare Node start for reference.
async function hookLatency(dir, env) {
  const payload = JSON.stringify({ cwd: dir, session_id: 'eval-latency', hook_event_name: 'PreToolUse', tool_name: 'Read',
    tool_input: { file_path: join(dir, 'src', 'engine', 'retrieve.js') } });
  const time = async (argv, input) => { const t = performance.now(); await run(process.execPath, argv, { cwd: dir, env, input, timeout: 30000 }); return performance.now() - t; };
  const hook = [], node = [];
  for (let i = 0; i < 10; i += 1) {
    hook.push(await time([join(dir, 'hooks', 'run.cjs'), 'pre-tool'], payload));
    node.push(await time(['-e', '']));
  }
  return { hook_ms: Math.round(median(hook)), node_ms: Math.round(median(node)) };
}

async function cloneRepo() {
  const dir = join(await mkdtemp(join(tmpdir(), 'dd-agent-')), 'supermem');
  execFileSync('git', ['clone', '-q', REPO, dir]);
  execFileSync('git', ['-C', dir, 'checkout', '-q', execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD']).toString().trim()]);
  // Dependencies are shared, not copied (~500 MB); a junction works without admin on Windows,
  // and the type is ignored elsewhere. No shell: the paths come from the environment.
  await symlink(join(REPO, 'node_modules'), join(dir, 'node_modules'), 'junction');
  return dir;
}

// Each clone gets its own resident, found through its own registry file, so runs
// can overlap and never touch the machine's resident. The session-start hook
// is the readiness probe: it answers through the bridge only once the resident
// has the project open with its model loaded. Without this the agent's first
// session start can arrive first and report DD inactive (seen in the smoke run).
async function startResident(dir, env) {
  const child = spawn(process.execPath, [join(dir, 'src', 'cli.js'), 'ui'], { cwd: dir, env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const payload = JSON.stringify({ cwd: dir, session_id: 'eval-warmup', hook_event_name: 'SessionStart', source: 'startup' });
  for (let i = 0; i < 60; i += 1) {
    const out = await run(process.execPath, [join(dir, 'hooks', 'run.cjs'), 'session-start'], { cwd: dir, env, input: payload, timeout: 30000 })
      .catch(() => ({ out: '' }));
    if (out.out.includes('additionalContext') && !/DD - Inactive/.test(out.out)) return { child, ready: true };
    await new Promise(r => setTimeout(r, 2000));
  }
  return { child, ready: false };
}

async function atomFiles(dir) {
  const { readdir } = await import('node:fs/promises');
  const walk = async d => (await readdir(d, { withFileTypes: true })).flatMap(e => e.isDirectory() ? [] : [join(d, e.name)])
    .concat(...await Promise.all((await readdir(d, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => walk(join(d, e.name)))));
  return walk(join(dir, '.dd', 'atoms'));
}

async function pruneMemories(dir, prefixes) {
  for (const file of await atomFiles(dir)) {
    const atom = JSON.parse(await readFile(file, 'utf8'));
    if (prefixes.some(prefix => atom.id.startsWith(prefix))) await rm(file);
  }
}

// The documentation conditions: the clone's own memories as one guide, written
// before .dd/ is removed. docref also names it in CLAUDE.md, which Claude Code
// loads with the project settings.
async function writeGuide(dir, referenced) {
  const atoms = await Promise.all((await atomFiles(dir)).map(async file => JSON.parse(await readFile(file, 'utf8'))));
  await writeFile(join(dir, 'docs', 'engineering-guide.md'), engineeringGuide(atoms));
  if (!referenced) return;
  const claude = join(dir, 'CLAUDE.md');
  await writeFile(claude, `${(await readFile(claude, 'utf8')).trimEnd()}

## Engineering guide

Conventions, pitfalls and past decisions for this codebase are in [docs/engineering-guide.md](docs/engineering-guide.md).
Read the sections that apply before changing code.
`);
}

// Tests that fail without any change, so a failure says nothing about the agent.
// This one waits a fixed 20 ms for the resident to see its model loaded: in the
// 2026-10-07 pilot it failed in all four fresh clones, both conditions, then
// passed 3/3 in the same clone once warm.
const KNOWN_FLAKY = ['the first prompt a resident answers names the audit UI and says DD became active, once per session'];

// npm is a .cmd shim on Windows, which spawn reaches only through a shell; the arguments are fixed.
async function suiteRun(dir, env) {
  const out = await run('npm', ['test'], { cwd: dir, env, shell: true, timeout: SUITE_TIMEOUT_MS }).catch(() => ({ out: '', code: 1 }));
  return { passed: out.code === 0 && !out.timedOut, failed: failedTests(out.out ?? '') };
}

// node --test lists each failure under "✖ failing tests:" as "✖ <name> (<ms>)".
function failedTests(output) {
  const tail = output.split('✖ failing tests:')[1] ?? '';
  return [...new Set([...tail.matchAll(/^✖ (.+?) \([\d.]+m?s\)$/gm)].map(m => m[1]))].slice(0, 20);
}

// The plugin's own registration, anchored at the clone: async observe,
// PostToolUseFailure and the timeouts are what a marketplace install gets.
async function ddSettings(dir) {
  const { hooks } = JSON.parse(await readFile(join(dir, 'hooks', 'hooks.json'), 'utf8'));
  return { hooks: JSON.parse(JSON.stringify(hooks).replaceAll('${CLAUDE_PLUGIN_ROOT}', dir.replaceAll('\\', '/'))) };
}

// The resident the run started, and the one a hook started in its place: an agent
// that edits src/ makes the first stale, and the next hook replaces it (eight such
// replacements outlived the first full trial).
async function stopResidents(dir, child) {
  const registry = JSON.parse(await readFile(join(dir, '..', 'resident.json'), 'utf8').catch(() => 'null'));
  for (const pid of new Set([child?.pid, registry?.pid].filter(Boolean))) killTree(pid);
}

// Unlink the shared node_modules junction first: a recursive delete that follows
// it empties the repository's own dependencies (git worktree remove --force did).
async function removeClone(dir) {
  await unlink(join(dir, 'node_modules')).catch(() => {});
  await rm(join(dir, '..'), { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }).catch(() => {});
}

class UsageLimit extends Error {
  constructor(text) { super(`usage limit: ${text}`); this.wait = limitWait(text); }
}

// A clone ready for the task: its setup applied and, without DD, no .dd/ either
// (an agent that greps .dd/ is using DD by hand, seen in the first trial run;
// git history still holds it). The agent's change is everything after the
// baseline commit, setup included in it.
async function prepareClone(task, condition) {
  const dir = await cloneRepo();
  if (task.setup) await task.setup(dir);
  if (condition === 'doc' || condition === 'docref') await writeGuide(dir, condition === 'docref');
  if (condition !== 'dd') await rm(join(dir, '.dd'), { recursive: true, force: true });
  if (condition === 'dd' && PRUNE.length) await pruneMemories(dir, PRUNE);
  git(dir, 'add', '-A');
  git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'eval baseline');
  return dir;
}

// The repository's own lint, as CI runs it. On failure the end of its output.
async function lintRun(dir, env) {
  const out = await run('npm', ['run', 'lint'], { cwd: dir, env, shell: true, timeout: LINT_TIMEOUT_MS }).catch(err => ({ code: 1, out: err.message }));
  const ok = out.code === 0 && !out.timedOut;
  return { lint_ok: ok, lint_output: ok ? null : String(out.out ?? '').slice(-1500) };
}

const conditionOf = row => row.condition ?? (row.dd ? 'dd' : 'none');

async function runOnce(task, condition, index) {
  const withDd = condition === 'dd';
  const runId = `${task.id}-${condition}-${index}`;
  const dir = await prepareClone(task, condition);
  // DD as a user runs it: no DD_RESIDENT=0, which makes session start report DD inactive.
  const env = { ...HOST_ENV, DD_DATA: join(dir, '..', 'dd-data'), DD_RESIDENT_REGISTRY: join(dir, '..', 'resident.json') };
  delete env.DD_RESIDENT;
  // The suite opens its own stores; it must not start or reach a resident.
  const testEnv = { ...env, DD_RESIDENT: '0' };
  let resident, ddReady = null, latency = {};
  // A headless session ends with its answer; a command left running in the
  // background is never read back (seen in the first full run).
  const prompt = `${task.prompt}

Run every command in the foreground and wait for it to finish before your final answer; give test runs a timeout of up to 10 minutes.`;
  const argv = ['-p', prompt, '--model', MODEL, '--output-format', 'stream-json', '--verbose', '--include-hook-events',
    '--no-session-persistence', '--setting-sources', 'project', '--strict-mcp-config', '--allowedTools', ...ALLOWED];
  if (withDd) {
    ({ child: resident, ready: ddReady } = await startResident(dir, env));
    // Before the agent edits src/: after that the resident is stale and a hook
    // measures its replacement, not the warm path.
    if (ddReady) latency = { ...await hookLatency(dir, env).catch(() => ({})), latency_before_agent: true };
    const settings = join(dir, '..', 'dd-settings.json');
    await writeFile(settings, JSON.stringify(await ddSettings(dir)));
    const mcp = join(dir, '..', 'dd-mcp.json');
    await writeFile(mcp, JSON.stringify({ mcpServers: { dd: { type: 'stdio', command: process.execPath, args: [join(dir, 'mcp.js')],
      env: { DD_DATA: env.DD_DATA, DD_RESIDENT_REGISTRY: env.DD_RESIDENT_REGISTRY } } } }));
    argv.push('--settings', settings, '--mcp-config', mcp);
  }
  const started = Date.now();
  let result, stream = '', timedOut = false;
  try {
    // No shell: it would join the arguments unquoted and split the prompt.
    const out = await run('claude', argv, { cwd: dir, env });
    stream = out.out; timedOut = out.timedOut;
    const events = stream.split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } });
    result = events.findLast(event => event?.type === 'result')
      ?? { is_error: true, result: timedOut ? 'timeout' : (stream.slice(-2000) + out.err) };
  } catch (err) { result = { is_error: true, result: err.message }; }
  const duration = Date.now() - started;
  if (usageLimited(result)) {
    if (withDd) await stopResidents(dir, resident);
    await removeClone(dir);
    throw new UsageLimit(String(result.result));
  }
  await writeFile(join(RUNS, `${runId}.jsonl`), stream);
  // The change as a reviewer sees it: new files included, DD's own store left out.
  git(dir, 'add', '-A', '--', '.', ':(exclude).dd');
  const patch = git(dir, 'diff', '--cached', 'HEAD');
  const numstat = git(dir, 'diff', '--cached', '--numstat', 'HEAD');
  await writeFile(join(RUNS, `${runId}.diff`), patch);
  // With DD the session's final result is the reply to DD's Stop-hook reminder, not the task report.
  const report = taskReport(stream) ?? String(result.result ?? '');
  const check = await task.check(dir, report).catch(err => ({ passed: false, detail: `check_failed: ${err.message}` }));
  if (withDd) await stopResidents(dir, resident);
  const lint = await lintRun(dir, testEnv);
  // Regressions: the whole suite on the changed tree, as CI would run it. A
  // failing suite runs once more: a regression is a test that fails both times
  // (the smoke run had one failure a clean clone never reproduced).
  const first = await suiteRun(dir, testEnv);
  const flakyOnly = suite => suite.failed.length > 0 && suite.failed.every(name => KNOWN_FLAKY.includes(name));
  const second = first.passed || flakyOnly(first) ? null : await suiteRun(dir, testEnv);
  const failedTwice = second && !second.passed && !flakyOnly(second)
    ? second.failed.filter(name => first.failed.includes(name) && !KNOWN_FLAKY.includes(name)) : [];
  // Failing twice can still be the machine. The baseline tree, without the change, settles it.
  let baseline = null;
  if (failedTwice.length || (second && !second.passed && !second.failed.length)) {
    git(dir, '-c', 'user.name=eval', '-c', 'user.email=eval@localhost', 'stash', 'push', '-u', '-q');
    baseline = await suiteRun(dir, testEnv);
    git(dir, 'stash', 'pop', '-q');
  }
  const regressions = baseline ? failedTwice.filter(name => !baseline.failed.includes(name)) : [];
  const usage = result.usage ?? {};
  const row = { run_id: runId, task: task.id, kind: task.kind, condition, dd: withDd, dd_ready: ddReady,
    passed: check.passed, detail: check.detail, requirements: check.requirements ?? {}, ...lint,
    // No regression: the suite passed, failed only on known timing tests, or every
    // test that failed twice also fails without the change.
    suite_passed: first.passed || flakyOnly(first) || Boolean(second && (second.passed || flakyOnly(second)))
      || Boolean(baseline && failedTwice.length && !regressions.length),
    suite_first_passed: first.passed, suite_failed_tests: failedTwice, suite_regressions: regressions,
    suite_known_flaky: [...new Set([...first.failed, ...(second?.failed ?? [])].filter(name => KNOWN_FLAKY.includes(name)))],
    suite_baseline_failed: baseline?.failed ?? null,
    suite_flaky_tests: second ? first.failed.filter(name => !second.failed.includes(name)) : [],
    numstat, ...latency,
    input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output_tokens: usage.output_tokens ?? 0, cost_usd: result.total_cost_usd ?? null, turns: result.num_turns ?? null,
    duration_ms: duration, timed_out: timedOut, answer: report.slice(0, 8000), final_answer: String(result.result ?? '').slice(0, 2000),
    error: result.is_error ? String(result.result).slice(0, 300) : null };
  await removeClone(dir);
  return row;
}

// The recorded change applied to a fresh baseline, and the task's check and lint
// again; the suite result stands. The first verdict stays on the row as `rechecked`.
async function recheck(row) {
  const task = TASKS.find(t => t.id === row.task);
  const condition = conditionOf(row);
  const dir = await prepareClone(task, condition);
  try {
    const patch = join(RUNS, `${row.run_id}.diff`);
    if ((await readFile(patch, 'utf8')).trim()) git(dir, 'apply', '--whitespace=nowarn', patch);
    const check = await task.check(dir, row.answer ?? '').catch(err => ({ passed: false, detail: `check_failed: ${err.message}` }));
    const lint = await lintRun(dir, { ...HOST_ENV, DD_RESIDENT: '0' });
    return { ...row, condition, passed: check.passed, detail: check.detail, requirements: check.requirements ?? {}, ...lint,
      rechecked: row.rechecked ?? { passed: row.passed, detail: row.detail } };
  } finally { await removeClone(dir); }
}

await mkdir(RUNS, { recursive: true });
if (RECHECK) {
  const rows = (await readFile(ROWS, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  for (const [i, row] of rows.entries()) {
    if (!(RECHECK.includes('all') || RECHECK.includes(row.task)) || usageLimited(row.error ?? '')) continue;
    rows[i] = await recheck(row);
    console.log(JSON.stringify({ run_id: row.run_id, was: row.passed, passed: rows[i].passed, detail: rows[i].detail }));
  }
  await writeFile(ROWS, rows.map(row => `${JSON.stringify(row)}\n`).join(''));
  await writeFile(OUT, JSON.stringify({ model: MODEL, repeat: REPEAT, pruned: PRUNE, runs: RUNS, rows }, null, 2));
  process.exit(0);
}
const done = new Set();
if ('resume' in args) {
  // Rows a usage limit cut short are dropped and run again.
  const kept = (await readFile(ROWS, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .filter(line => !usageLimited(JSON.parse(line).error ?? ''));
  await writeFile(ROWS, kept.map(line => `${line}\n`).join(''));
  for (const line of kept) done.add(JSON.parse(line).run_id);
} else await rm(ROWS, { force: true });
// Repetition-major order, so a stopped trial still has every task in every condition.
const jobs = [];
for (let i = 0; i < REPEAT; i += 1) for (const task of TASKS.filter(t => !ONLY || ONLY.includes(t.id))) for (const condition of CONDITIONS) {
  if (!done.has(`${task.id}-${condition}-${i}`)) jobs.push([task, condition, i]);
}
// --conc=N overlaps runs: each has its own clone, data directory and resident.
async function worker() {
  for (let job = jobs.shift(); job; job = jobs.shift()) {
    let row;
    try { row = await runOnce(...job); } catch (err) {
      if (!(err instanceof UsageLimit)) throw err;
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
await writeFile(OUT, JSON.stringify({ model: MODEL, repeat: REPEAT, pruned: PRUNE, runs: RUNS, rows }, null, 2));
console.log(JSON.stringify({ model: MODEL, runs: rows.length, report: OUT }, null, 2));
