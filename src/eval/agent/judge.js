#!/usr/bin/env node
// Blind review of each run's change against the requirements of its task: those
// the project's knowledge states for this change that no check can decide
// (requirements without `auto` in src/eval/agent/tasks.js), and the code quality
// GENERAL_REQUIREMENTS expects of any change. The judge sees the task, the
// guidance that applies, the requirements, the diff and the developer's report
// with whatever names DD or the guide removed; never the condition.
//
// The judge runs with no tools from an empty directory: it reviews the change
// as written, without the repository or its DD store.
//
// This spends real model usage. It runs only when invoked:
//   node src/eval/agent/judge.js --in=quality.json [--model=claude-opus-5-5] [--conditions=dd,doc,docref] [--conc=2] [--limit=N] [--resume]
import { appendFile, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { guideSection, guideSectionV2 } from './guide.js';
import { limitWait, redact, usageLimited } from './metrics.js';
import { run } from './proc.js';
import { GENERAL_REQUIREMENTS } from './tasks.js';
import { TRIAL_MEMORIES } from './trial-memories.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const MODEL = args.model ?? 'claude-opus-5-5';
const IN = join(REPO, 'output', 'eval', args.in ?? 'agent-results.json');
// The task set the results were made with decides which tasks and guidance apply.
const TASKSET = JSON.parse(await readFile(IN, 'utf8')).taskset ?? 'v1';
const bench = TASKSET === 'bench' ? await import('../bench/tasks.js') : null;
const benchSet = bench ? await bench.loadBench(await bench.registryAt(args.registry)) : null;
const { TASKS } = benchSet ? { TASKS: benchSet.tasks } : await import(TASKSET === 'v2' ? './tasks-v2.js' : './tasks.js');
const OUT = IN.replace(/\.json$/, '') + '.judge.json';
const ROWS = OUT.replace(/\.json$/, '') + '.rows.jsonl';
// A bench judges every condition, dd2 and none included.
const CONDITIONS = (args.conditions ?? (TASKSET === 'bench' ? 'dd2,docref,doc,none' : 'dd,doc,docref')).split(',');
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const MAX_DIFF = 60000;
const TIMEOUT_MS = 5 * 60 * 1000;

// The prompt goes through stdin: a diff can pass the Windows command-line limit.
const claude = (prompt, cwd) => run('claude', ['-p', '--model', MODEL, '--output-format', 'json', '--no-session-persistence',
  '--setting-sources', '', '--strict-mcp-config', '--tools', ''], { cwd, input: prompt, timeout: TIMEOUT_MS });

// The guidance a task's memory carries, as the guide writes it.
async function guidance() {
  if (benchSet) return new Map();
  if (TASKSET === 'v2') {
    return new Map(TRIAL_MEMORIES.map(m => [m.topic, guideSectionV2({ ...m, status: 'active', evidence: m.evidence.map(e => ({ type: 'file', ...e })) })]));
  }
  const atoms = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else atoms.push(JSON.parse(await readFile(join(dir, entry.name), 'utf8')));
    }
  };
  await walk(join(REPO, '.dd', 'atoms'));
  return new Map(atoms.filter(a => a.lifecycle_state === 'active').map(a => [a.topic_key, guideSection(a)]));
}

const clip = text => (text.length > MAX_DIFF ? `${text.slice(0, MAX_DIFF)}\n[... diff truncated at ${MAX_DIFF} characters]` : text);
const judgedRequirements = task => [...(task.requirements ?? []).filter(r => !r.auto), ...GENERAL_REQUIREMENTS];

function prompt(task, guide, row, diff) {
  const requirements = judgedRequirements(task);
  return `You are reviewing a change to a ${task.language ?? 'JavaScript'} repository, made by a developer for the task below. Decide, as a senior reviewer of this codebase would, whether the change meets each requirement listed.

Task given to the developer:
"${task.prompt}"

Project guidance that applies to this kind of change:
${guide ?? '(none beyond the general requirements)'}

Requirements to decide:
${requirements.map(r => `- ${r.id}: ${r.text}`).join('\n')}

Use the developer's report to understand intent, or a decision not to change something; judge what the change actually does.

Reply with only this JSON object and nothing else, with true or false for every requirement:
{"requirements":{${requirements.map(r => `"${r.id}":true`).join(',')}},"notes":"one or two sentences"}

## Developer's final report
${redact(row.answer) || '(no report)'}

## Diff
\`\`\`diff
${clip(diff) || '(no changes)'}
\`\`\`
`;
}

function parseVerdict({ out, err = '', code, timedOut }, ids) {
  let envelope;
  try { envelope = JSON.parse(out); } catch {
    return { error: `unparsable_output (exit ${code}${timedOut ? ', timed out' : ''}): ${String(out).slice(0, 100)} ${String(err).slice(-200)}`, cost_usd: null };
  }
  const text = String(envelope.result ?? '');
  let verdict = null;
  try { verdict = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0]); } catch { /* reported below */ }
  const requirements = Object.fromEntries(ids.map(id => [id, typeof verdict?.requirements?.[id] === 'boolean' ? verdict.requirements[id] : null]));
  const missing = ids.filter(id => requirements[id] === null);
  return { requirements, notes: verdict?.notes ?? null, cost_usd: envelope.total_cost_usd ?? null,
    error: missing.length ? `unparsable_verdict (${missing.join(', ')}): ${text.slice(0, 200)}` : null };
}

// A usage limit is waited out and the same review asked again.
async function review(text, ids, cwd) {
  for (;;) {
    const reply = await claude(text, cwd);
    let envelope = null;
    try { envelope = JSON.parse(reply.out); } catch { /* parseVerdict reports it */ }
    // Without a JSON envelope the limit message can come on stderr.
    const message = envelope?.result ?? `${reply.out}\n${reply.err}`;
    if (!usageLimited(envelope) && !usageLimited(message)) return parseVerdict(reply, ids);
    const wait = limitWait(message);
    console.log(JSON.stringify({ waiting_minutes: Math.round(wait / 60000), error: String(message).slice(0, 200) }));
    await new Promise(r => setTimeout(r, wait));
  }
}

const results = JSON.parse(await readFile(IN, 'utf8'));
const guides = await guidance();
const done = new Map();
if ('resume' in args) {
  // A run with an unreadable verdict is judged again.
  const kept = (await readFile(ROWS, 'utf8').catch(() => '')).split('\n').filter(Boolean).filter(line => !JSON.parse(line).error);
  await writeFile(ROWS, kept.map(line => `${line}\n`).join(''));
  for (const line of kept) { const row = JSON.parse(line); done.set(row.run_id, row); }
} else await rm(ROWS, { force: true });

const condition = row => row.condition ?? (row.dd ? 'dd' : 'none');
const queue = results.rows.filter(row => CONDITIONS.includes(condition(row)) && !row.error && !done.has(row.run_id)).slice(0, LIMIT);
const empty = await mkdtemp(join(tmpdir(), 'dd-judge-'));
async function worker() {
  for (let row = queue.shift(); row; row = queue.shift()) {
    const task = TASKS.find(t => t.id === row.task);
    const diff = await readFile(join(results.runs, `${row.run_id}.diff`), 'utf8').catch(() => '');
    const ids = judgedRequirements(task).map(r => r.id);
    const verdict = await review(prompt(task, benchSet ? bench.guidanceFor(task, benchSet.projects) : (task.memory ? guides.get(task.memory) : null), row, diff), ids, empty);
    const judged = { run_id: row.run_id, task: row.task, kind: row.kind, condition: condition(row), ...verdict };
    await appendFile(ROWS, JSON.stringify(judged) + '\n');
    console.log(JSON.stringify({ run_id: row.run_id, requirements: judged.requirements, cost_usd: judged.cost_usd, error: judged.error }));
    done.set(row.run_id, judged);
  }
}
await Promise.all(Array.from({ length: Number(args.conc ?? 2) }, worker));
await rm(empty, { recursive: true, force: true });
await writeFile(OUT, JSON.stringify({ model: MODEL, input: IN, judgments: [...done.values()] }, null, 2));
console.log(JSON.stringify({ model: MODEL, judged: done.size, report: OUT }));
