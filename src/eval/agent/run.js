#!/usr/bin/env node
// Agent-level evaluation (phase 6): the same task, done by a real coding agent
// with DD and without it, compared on outcome and on what it cost.
//
// Each run gets a fresh clone of the current commit. Claude Code runs headless
// with only project settings: no user plugins, hooks or MCP servers. The DD
// condition adds DD's hooks and MCP server explicitly and starts the resident
// process first, so the first prompt already gets semantic retrieval. The
// agent's own memory is keyed by directory, so every clone starts empty.
//
// This spends real model usage. It runs only when invoked:
//   node src/eval/agent/run.js [--model claude-sonnet-5] [--repeat 2] [--tasks a,b]
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASKS } from './tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const MODEL = args.model ?? 'claude-sonnet-5';
const REPEAT = Number(args.repeat ?? 2);
const ONLY = args.tasks ? args.tasks.split(',') : null;
const TIMEOUT_MS = 20 * 60 * 1000;
const ALLOWED = ['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(node:*)', 'Bash(npm:*)', 'Bash(git:*)', 'mcp__dd'];

function run(command, argv, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, argv, { windowsHide: true, ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('timeout')); }, TIMEOUT_MS);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { if (err.length < 4000) err += d; });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => { clearTimeout(timer); resolveRun({ code, out, err }); });
  });
}

async function cloneRepo() {
  const dir = join(await mkdtemp(join(tmpdir(), 'dd-agent-')), 'supermem');
  execFileSync('git', ['clone', '-q', REPO, dir]);
  execFileSync('git', ['-C', dir, 'checkout', '-q', execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD']).toString().trim()]);
  // Dependencies are shared, not copied (~500 MB); a junction works without admin on Windows.
  if (process.platform === 'win32') execFileSync('cmd', ['/c', 'mklink', '/J', join(dir, 'node_modules'), join(REPO, 'node_modules')], { stdio: 'ignore' });
  else execFileSync('ln', ['-s', join(REPO, 'node_modules'), join(dir, 'node_modules')]);
  return dir;
}

async function startResident(dir, env) {
  const child = spawn(process.execPath, [join(dir, 'src', 'cli.js'), 'ui'], { cwd: dir, env, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const { residentStatus } = await import(new URL('../../resident.js', import.meta.url));
  for (let i = 0; i < 90; i += 1) {
    const status = await residentStatus(dir);
    if (status?.retrieval === 'semantic') return child;
    await new Promise(r => setTimeout(r, 1000));
  }
  return child;
}

function ddSettings(dir) {
  const hook = event => [{ hooks: [{ type: 'command', command: `node "${join(dir, 'hooks', 'run.cjs')}" ${event}`, timeout: 15 }] }];
  return { hooks: { SessionStart: hook('session-start'), UserPromptSubmit: hook('prompt'),
    PreToolUse: [{ matcher: '*', hooks: hook('pre-tool')[0].hooks }], PostToolUse: [{ matcher: '*', hooks: hook('observe')[0].hooks }],
    Stop: hook('stop') } };
}

async function runOnce(task, withDd) {
  const dir = await cloneRepo();
  const env = { ...process.env, DD_DATA: join(dir, '..', 'dd-data'), DD_RESIDENT: '0' };
  let resident;
  const argv = ['-p', task.prompt, '--model', MODEL, '--output-format', 'json', '--no-session-persistence',
    '--setting-sources', 'project', '--strict-mcp-config', '--allowedTools', ...ALLOWED];
  if (withDd) {
    resident = await startResident(dir, env);
    const settings = join(dir, '..', 'dd-settings.json');
    await writeFile(settings, JSON.stringify(ddSettings(dir)));
    const mcp = join(dir, '..', 'dd-mcp.json');
    await writeFile(mcp, JSON.stringify({ mcpServers: { dd: { type: 'stdio', command: process.execPath, args: [join(dir, 'mcp.js')], env: { DD_DATA: env.DD_DATA, DD_RESIDENT: '0' } } } }));
    argv.push('--settings', settings, '--mcp-config', mcp);
  }
  const started = Date.now();
  let result;
  try {
    const out = await run('claude', argv, { cwd: dir, env, shell: process.platform === 'win32' });
    try { result = JSON.parse(out.out); } catch { result = { is_error: true, result: out.out.slice(0, 2000) + out.err }; }
  } catch (err) { result = { is_error: true, result: err.message }; }
  const check = await task.check(dir, result.result ?? '').catch(err => ({ passed: false, detail: `check_failed: ${err.message}` }));
  if (resident) try { process.kill(resident.pid); } catch { /* already gone */ }
  const usage = result.usage ?? {};
  const row = { task: task.id, dd: withDd, passed: check.passed, detail: check.detail,
    input_tokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0),
    output_tokens: usage.output_tokens ?? 0, cost_usd: result.total_cost_usd ?? null, turns: result.num_turns ?? null,
    duration_ms: Date.now() - started, error: result.is_error ? String(result.result).slice(0, 300) : null };
  await rm(join(dir, '..'), { recursive: true, force: true }).catch(() => {});
  return row;
}

const rows = [];
for (const task of TASKS.filter(t => !ONLY || ONLY.includes(t.id))) {
  for (let i = 0; i < REPEAT; i += 1) for (const withDd of [false, true]) {
    const row = await runOnce(task, withDd);
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
const summary = {};
for (const withDd of [false, true]) {
  const group = rows.filter(r => r.dd === withDd);
  const sum = key => group.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  summary[withDd ? 'with_dd' : 'without_dd'] = { runs: group.length, passed: group.filter(r => r.passed).length,
    input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), cost_usd: Number(sum('cost_usd').toFixed(4)),
    turns: sum('turns'), minutes: Number((sum('duration_ms') / 60000).toFixed(1)) };
}
const out = join(REPO, 'output', 'eval', 'agent-results.json');
await mkdir(join(REPO, 'output', 'eval'), { recursive: true });
await writeFile(out, JSON.stringify({ model: MODEL, repeat: REPEAT, summary, rows }, null, 2));
console.log(JSON.stringify({ model: MODEL, summary, report: out }, null, 2));
