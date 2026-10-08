// The v2 bench (docs/superpowers/plans/2026-10-08-dd-v2-plan-0-bench.md): the
// trial's recorded runs replayed through trigger matching, with no agent runs.
//   node src/eval/v2bench/run.js [--fixture=PATH] [--no-latency] [--out=output/eval/v2bench-report.json]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertV1 } from '../../memory/convert-v1.js';
import { scoreCheck, scoreCommandCheck } from './checks.js';
import { classifyMemory } from './classify.js';
import { loadFixture } from './fixture.js';
import { stalenessTiming, timeSpawn } from './latency.js';
import { benchMetrics } from './metrics.js';
import { replay } from './replay.js';
import { SPIKE_CHECKS, SPIKE_COMMAND_CHECKS } from './spike-checks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const OUT = resolve(REPO, args.out ?? 'output/eval/v2bench-report.json');

async function readV1(ddDir) {
  const atoms = [];
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (entry.isDirectory()) await walk(join(dir, entry.name));
      else if (entry.name.endsWith('.json')) atoms.push(JSON.parse(await readFile(join(dir, entry.name), 'utf8')));
    }
  };
  for (const sub of ['atoms', 'legacy']) await walk(join(ddDir, sub));
  return atoms.filter(atom => ['active', 'contested', 'legacy'].includes(atom.lifecycle_state));
}

// Trigger variants the decisions compare (spec section 3, review note on clause breadth).
export const VARIANTS = {
  spec: memory => memory,
  'edit-paths': memory => ({ ...memory, triggers: memory.triggers.map(c => (c.paths ? { ...c, on: ['edit', 'write'] } : c)) }),
  'paths-only': memory => ({ ...memory, triggers: memory.triggers.filter(c => c.paths) }),
  'keywords-only': memory => ({ ...memory, triggers: memory.triggers.filter(c => c.keywords) }),
};

const v1 = await readV1(join(REPO, '.dd'));
const titles = new Map(v1.map(atom => [atom.id, atom.title]));
const memories = v1.map(atom => convertV1(atom, { titles }));
const fixture = await loadFixture(args.fixture ? resolve(REPO, args.fixture) : undefined);
const conditions = [...new Set(fixture.runs.map(run => run.condition))];

const report = { generated_at: new Date().toISOString(), memories: memories.length, runs: fixture.runs.length, variants: {} };
for (const [name, transform] of Object.entries(VARIANTS)) {
  const set = memories.map(transform);
  const results = replay(fixture, set);
  const all = benchMetrics(fixture, results, set);
  const byCondition = Object.fromEntries(conditions.map(condition => {
    const subset = { ...fixture, runs: fixture.runs.filter(run => run.condition === condition) };
    return [condition, benchMetrics(subset, results.filter(r => r.condition === condition), set).summary];
  }));
  report.variants[name] = { summary: all.summary, by_condition: byCondition };
}
report.checks = SPIKE_CHECKS.map(spec => scoreCheck(spec, fixture));
report.command_checks = SPIKE_COMMAND_CHECKS.map(spec => scoreCommandCheck(spec, fixture));
const classes = memories.map(classifyMemory);
report.classification = { counts: classes.reduce((n, c) => ({ ...n, [c.class]: (n[c.class] ?? 0) + 1 }), {}), memories: classes };
report.review_issues = memories.reduce((n, m) => { for (const issue of m.review.issues) n[issue] = (n[issue] ?? 0) + 1; return n; }, {});

if (!('no-latency' in args)) {
  const dir = mkdtempSync(join(tmpdir(), 'dd-bench-hook-'));
  try {
    const index = join(dir, 'index.json');
    writeFileSync(index, JSON.stringify(memories));
    const sim = fileURLToPath(new URL('./hook-sim.mjs', import.meta.url));
    const event = JSON.stringify({ kind: 'read', paths: ['src/store/paths.js'] });
    report.latency = {
      node_start: timeSpawn(['-e', '']),
      hook: timeSpawn([sim, index, join(dir, 'ledger.jsonl')], { input: event }),
    };
  } finally { rmSync(dir, { recursive: true, force: true }); }
  report.staleness = await stalenessTiming();
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 2));

const s = name => report.variants[name].summary;
const lines = [
  '| Variant | Key delivered | Before first edit | Noise (memory / control tasks) | Tokens median / p90 | Runs with 0 tokens | Hubs |',
  '|---|---|---|---|---|---|---|',
  ...Object.keys(VARIANTS).map(name => `| ${name} | ${s(name).key_delivered}/${s(name).memory_runs} | ${s(name).key_before_edit}/${s(name).memory_runs} | ${s(name).median_noise_memory_tasks} / ${s(name).median_noise_control_tasks} | ${s(name).median_tokens} / ${s(name).p90_tokens} | ${s(name).zero_token_runs}/${s(name).runs} | ${s(name).hubs.map(h => `${h.topic} ${h.rate}%`).join(', ') || 'none'} |`),
  '',
  '| Check | Examples hold | TP | FP | FN | TN | Fired / runs seen |',
  '|---|---|---|---|---|---|---|',
  ...report.checks.map(c => `| ${c.memory} | ${c.examples_hold} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.tn} | ${c.fired}/${c.runs_seen} |`),
  '',
  `Command checks: ${report.command_checks.map(c => `${c.memory} fired in ${c.fired} runs`).join('; ')}`,
  `Classification: ${JSON.stringify(report.classification.counts)}; review issues: ${JSON.stringify(report.review_issues)}`,
  report.latency ? `Latency (ms): node start ${JSON.stringify(report.latency.node_start)}, hook ${JSON.stringify(report.latency.hook)}` : 'Latency: skipped',
  report.staleness ? `Staleness at ${report.staleness.files} files (ms): stat all ${JSON.stringify(report.staleness.stat_all)}, manifest ${JSON.stringify(report.staleness.manifest)}` : '',
];
console.log(lines.join('\n'));
console.log(`\nfull report: ${OUT}`);
