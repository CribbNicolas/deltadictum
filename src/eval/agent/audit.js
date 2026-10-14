#!/usr/bin/env node
// The owner's audit of the blind judge, blind as well: one Markdown file per
// judged run with the task, the requirements, the judge's verdict, the
// developer's report and the diff, numbered at random, with the condition and the
// names DD or the guide use redacted; key.json maps the numbers back.
//   node src/eval/agent/audit.js --in=trial-v2-opus.json            writes <in>.audit/NN.md and key.json
//   node src/eval/agent/audit.js --in=trial-v2-opus.json --apply=verdicts.jsonl
// --apply reads lines {"n":NN,"requirements":{...},"notes":"..."} and writes the
// audited verdicts into <in>.judge.json, keeping the judge's originals beside
// them, so report.js reads the audited ones and every override is on record.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact } from './metrics.js';
import { GENERAL_REQUIREMENTS } from './tasks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const IN = join(REPO, 'output', 'eval', args.in ?? 'agent-results.json');
const JUDGE = IN.replace(/\.json$/, '') + '.judge.json';
const DIR = IN.replace(/\.json$/, '') + '.audit';
const MAX_DIFF = 60000;

const results = JSON.parse(await readFile(IN, 'utf8'));
const { TASKS } = await import((results.taskset ?? 'v1') === 'v2' ? './tasks-v2.js' : './tasks.js');
const judge = JSON.parse(await readFile(JUDGE, 'utf8'));
const judgedRequirements = task => [...(task.requirements ?? []).filter(r => !r.auto), ...GENERAL_REQUIREMENTS];

if (args.apply) {
  const verdicts = (await readFile(resolve(REPO, 'output', 'eval', args.apply), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  const key = JSON.parse(await readFile(join(DIR, 'key.json'), 'utf8'));
  const byRun = new Map(verdicts.map(v => [key[String(v.n).padStart(2, '0')], v]));
  let overrides = 0;
  for (const judgment of judge.judgments) {
    const verdict = byRun.get(judgment.run_id);
    if (!verdict) continue;
    judgment.judge_requirements ??= { ...judgment.requirements };
    const changed = Object.entries(verdict.requirements).filter(([id, value]) => judgment.judge_requirements[id] !== value);
    overrides += changed.length;
    judgment.requirements = { ...judgment.requirements, ...verdict.requirements };
    judgment.audit = { notes: verdict.notes ?? null, overrides: changed.map(([id, value]) => ({ id, judge: judgment.judge_requirements[id], audit: value })) };
  }
  judge.audited = { verdicts: verdicts.length, overrides, at: new Date().toISOString() };
  await writeFile(JUDGE, JSON.stringify(judge, null, 2));
  console.log(JSON.stringify({ applied: verdicts.length, overrides, judge: JUDGE }));
  process.exit(0);
}

// A fixed shuffle, so the numbering is the same on every run and tells nothing.
const order = [...judge.judgments].filter(j => !j.error).sort((a, b) => hash(a.run_id) - hash(b.run_id));
function hash(text) { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
await mkdir(DIR, { recursive: true });
const key = {};
for (const [i, judgment] of order.entries()) {
  const n = String(i + 1).padStart(2, '0');
  key[n] = judgment.run_id;
  const row = results.rows.find(r => r.run_id === judgment.run_id);
  const task = TASKS.find(t => t.id === row.task);
  const diff = await readFile(join(results.runs, `${row.run_id}.diff`), 'utf8').catch(() => '');
  const requirements = judgedRequirements(task);
  const auto = Object.entries(row.requirements ?? {}).filter(([, v]) => typeof v === 'boolean');
  const text = [`# Run ${n}: task ${task.id}`, '',
    '## Task', '', task.prompt, '',
    '## Requirements the judge decided', '', ...requirements.map(r => `- ${r.id}: ${r.text}`), '',
    '## Automatic checks (for context)', '', `passed: ${row.passed} (${row.detail})`, ...auto.map(([id, v]) => `- ${id}: ${v}`), '',
    '## Judge verdict', '', '```json', JSON.stringify({ requirements: judgment.requirements, notes: judgment.notes }, null, 2), '```', '',
    '## Developer report (redacted)', '', redact(row.answer) || '(no report)', '',
    '## Diff', '', '```diff', diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n[... truncated]` : diff || '(no changes)', '```', ''].join('\n');
  await writeFile(join(DIR, `${n}.md`), text);
}
await writeFile(join(DIR, 'key.json'), JSON.stringify(key, null, 2));
console.log(JSON.stringify({ runs: order.length, dir: DIR }));
