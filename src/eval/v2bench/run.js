// The v2 bench: the
// trial's recorded runs replayed through trigger matching, with no agent runs.
//   node src/eval/v2bench/run.js [--fixture=PATH] [--no-latency] [--out=output/eval/v2bench-report.json]
//     [--memories=store] [--freeze]
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileIndex, writeCompiled } from '../../engine/compile.js';
import { localPaths } from '../../engine/locate.cjs';
import { loadIndex } from '../../engine/index-file.cjs';
import { matchEvent, prepareIndex } from '../../engine/match.cjs';
import { toolEvent } from '../../hooks/v2/events.cjs';
import { synthesizeMemories } from './synth.js';
import { productionEngine } from './engine.js';
import { scoreCheck, scoreCommandCheck } from './checks.js';
import { classifyMemory } from './classify.js';
import { loadFixture } from './fixture.js';
import { stalenessTiming, timeInterleaved, timeSpawn } from './latency.js';
import { FROZEN_MEMORIES, freezeBenchMemories, frozenBenchMemories, loadBenchMemories } from './memories.js';
import { benchMetrics } from './metrics.js';
import { replay } from './replay.js';
import { SPIKE_CHECKS, SPIKE_COMMAND_CHECKS } from './spike-checks.js';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const OUT = resolve(REPO, args.out ?? 'output/eval/v2bench-report.json');

// Trigger variants the decisions compare (spec section 3, review note on clause breadth).
export const VARIANTS = {
  spec: memory => memory,
  'edit-paths': memory => ({ ...memory, triggers: memory.triggers.map(c => (c.paths ? { ...c, on: ['edit', 'write'] } : c)) }),
  'paths-only': memory => ({ ...memory, triggers: memory.triggers.filter(c => c.paths) }),
  'keywords-only': memory => ({ ...memory, triggers: memory.triggers.filter(c => c.keywords) }),
};

// The frozen memories by default; --memories=store reads the project's store, and
// --freeze writes what it reads as the new frozen set.
const fromStore = args.memories === 'store' || 'freeze' in args;
const memories = fromStore ? await loadBenchMemories(join(REPO, '.dd')) : await frozenBenchMemories();
if (!memories.length) throw new Error('bench_no_memories: nothing live under .dd/atoms, .dd/legacy or .dd/memories');
if ('freeze' in args) {
  console.log(`froze ${await freezeBenchMemories(memories)} memories into ${FROZEN_MEMORIES}`);
  process.exit(0);
}
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
{
  // The production engine (compiled index, matchEvent) must deliver exactly what the reference does.
  const results = replay(fixture, memories, productionEngine);
  report.variants.production = { summary: benchMetrics(fixture, results, memories).summary };
  // Compared by content, run by run: the production engine orders hits by rank, the reference by memory.
  const plain = list => JSON.stringify(list.map(r => [r.run_id, [...r.delivered].map(([id, hit]) => `${id}@${hit.at}:${hit.via.join('+')}`).sort()]));
  report.production_equals_reference = plain(results) === plain(replay(fixture, memories));
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
      hook: timeSpawn(null, { input: event, prepare: i => [sim, index, join(dir, `ledger-${i}.jsonl`)] }),
    };
    // The production hot path over a project compiled from these memories, and
    // over 300 synthesized ones (a project with years of memories).
    const compiled = (name, set) => {
      const root = join(dir, name);
      const paths = localPaths(root);
      mkdirSync(paths.memories, { recursive: true });
      writeFileSync(paths.manifest, JSON.stringify({ version: 1, count: set.length, hash: 'bench' }));
      writeCompiled(paths, compileIndex({ memories: set, manifest: { count: set.length, hash: 'bench' } }));
      return { root, runtime: prepareIndex(loadIndex(root)), count: set.length };
    };
    const synthetic = synthesizeMemories(fixture, 300);
    const scales = { project: compiled('project', memories), synthetic: compiled('synthetic', synthetic) };
    // The common case must really fire nothing, and the other must fire: a wrong
    // event would time one path under the other's label.
    const quietCandidates = [{ kind: 'read', paths: ['bench-quiet/untouched.txt'] }, { kind: 'run', paths: [], text: 'echo dd-bench-quiet' }];
    const fixtureReads = fixture.runs.flatMap(run => run.events).filter(e => e.kind === 'read');
    // What Claude Code sends for an event, so the timing covers the real entry
    // point (hooks/run.cjs): payload parsing, the project root and normalization.
    const payloadFor = (scale, e, session) => ({ session_id: session, cwd: scale.root, hook_event_name: 'PreToolUse',
      ...(e.kind === 'run' ? { tool_name: 'Bash', tool_input: { command: e.text } } : { tool_name: 'Read', tool_input: { file_path: join(scale.root, e.paths[0]) } }) });
    const fires = (scale, e) => matchEvent(scale.runtime, toolEvent(payloadFor(scale, e).tool_name, payloadFor(scale, e).tool_input, scale.root)).length > 0;
    for (const [name, scale] of Object.entries(scales)) {
      scale.quiet = quietCandidates.find(e => !fires(scale, e));
      scale.fires = [JSON.parse(event), ...fixtureReads].find(e => fires(scale, e));
      if (!scale.quiet || !scale.fires) throw new Error(`bench_events_unusable:${name}`);
    }
    const hook = fileURLToPath(new URL('../../../hooks/run.cjs', import.meta.url));
    const bare = join(dir, 'no-dd');
    mkdirSync(join(bare, '.git'), { recursive: true });
    // Interleaved so drift hits every series alike.
    const series = { node: { prepare: () => ['-e', ''] },
      no_dd: { prepare: () => [hook, 'pre-tool'], input: JSON.stringify({ session_id: 's', cwd: bare, tool_name: 'Read', tool_input: { file_path: join(bare, 'a.js') } }) } };
    for (const [name, scale] of Object.entries(scales)) {
      series[`${name}_nothing_fires`] = { prepare: () => [hook, 'pre-tool'], input: JSON.stringify(payloadFor(scale, scale.quiet, 'quiet')) };
      // A fresh session per run, so every run delivers.
      series[`${name}_fires`] = { prepare: i => [hook, 'pre-tool'], inputFor: i => JSON.stringify(payloadFor(scale, scale.fires, `fire-${i}`)) };
    }
    const timed = timeInterleaved(series);
    const over = name => Math.round((timed[name].p50 - timed.node.p50) * 10) / 10;
    report.latency.production = Object.fromEntries(Object.entries(scales).map(([name, scale]) => [name, { memories: scale.count,
      overhead_nothing_fires_ms: over(`${name}_nothing_fires`), overhead_fires_ms: over(`${name}_fires`) }]));
    report.latency.production.no_dd_ms = over('no_dd');
    report.latency.production.timed = timed;
  } finally { rmSync(dir, { recursive: true, force: true }); }
  report.staleness = await stalenessTiming();
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(report, null, 2));

const s = name => report.variants[name].summary;
const lines = [
  '| Variant | Key delivered | Before first edit | Noise (memory / control tasks) | Tokens median / p90 | Runs with 0 tokens | Hubs |',
  '|---|---|---|---|---|---|---|',
  ...[...Object.keys(VARIANTS), 'production'].map(name => `| ${name} | ${s(name).key_delivered}/${s(name).memory_runs} | ${s(name).key_before_edit}/${s(name).memory_runs} | ${s(name).median_noise_memory_tasks} / ${s(name).median_noise_control_tasks} | ${s(name).median_tokens} / ${s(name).p90_tokens} | ${s(name).zero_token_runs}/${s(name).runs} | ${s(name).hubs.map(h => `${h.topic} ${h.rate}%`).join(', ') || 'none'} |`),
  '',
  '| Check | Examples hold | TP | FP | FN | TN | Fired / runs seen |',
  '|---|---|---|---|---|---|---|',
  ...report.checks.map(c => `| ${c.memory} | ${c.examples_hold} | ${c.tp} | ${c.fp} | ${c.fn} | ${c.tn} | ${c.fired}/${c.runs_seen} |`),
  '',
  `Command checks: ${report.command_checks.map(c => `${c.memory} fired in ${c.fired} runs`).join('; ')}`,
  `Classification: ${JSON.stringify(report.classification.counts)}; review issues: ${JSON.stringify(report.review_issues)}`,
  report.latency ? `Latency (ms): node start ${JSON.stringify(report.latency.node_start)}, hook ${JSON.stringify(report.latency.hook)}` : 'Latency: skipped',
  ...(report.latency ? ['project', 'synthetic'].map(name => { const r = report.latency.production[name]; return `hooks/run.cjs pre-tool overhead over node start (ms, p50, interleaved), ${r.memories} memories: nothing fires ${r.overhead_nothing_fires_ms}, fires ${r.overhead_fires_ms}`; }) : []),
  report.latency ? `hooks/run.cjs pre-tool in a project without DD: ${report.latency.production.no_dd_ms} ms over node start` : '',
  `Production engine equals reference: ${report.production_equals_reference}`,
  report.staleness ? `Staleness at ${report.staleness.files} files (ms): stat all ${JSON.stringify(report.staleness.stat_all)}, manifest ${JSON.stringify(report.staleness.manifest)}` : '',
];
console.log(lines.join('\n'));
console.log(`\nfull report: ${OUT}`);
