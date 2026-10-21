// Layer 1 of the full benchmark: every fixture's runs, under every mutation, replayed through the
// production engine and the reference engine, with no model. Free; runs in CI through the fixture test.
//   node src/eval/bench/layer1/run.js [--write-expected]
// Fixtures: src/eval/bench/layer1/fixtures/*.json.gz, plus Patriark's in output/eval where it exists.
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { productionEngine } from '../../replay/engine.js';
import { replay } from '../../replay/replay.js';
import { benchMemories } from '../store.js';
import { FIXTURES, LOCAL_FIXTURES, LOCAL_ONLY } from './extract.js';
import { layer1Summary } from './metrics.js';
import { MUTATIONS, mutateRun } from './mutate.js';

const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
export const SEED = 20261016;

export const loadLayer1 = async path => JSON.parse(gunzipSync(await readFile(path)).toString('utf8'));

export async function memoriesFor(projectId) {
  const { PROJECTS } = await import('../tasks.js');
  const project = PROJECTS.find(p => p.id === projectId);
  if (!project) throw new Error(`layer 1: no bench project ${projectId}`);
  return benchMemories(project);
}

// Compared by content, run by run: the production engine orders hits by rank, the reference by memory.
const plain = results => JSON.stringify(results.map(r => [r.run_id, [...r.delivered].map(([id, hit]) => `${id}@${hit.at}:${hit.via.join('+')}`).sort()]));

export function replayProject(fixture, memories, seed = SEED) {
  const mutated = { ...fixture, runs: MUTATIONS.flatMap(mutation => fixture.runs.map(run => mutateRun(run, mutation, seed))) };
  const results = replay(mutated, memories, productionEngine);
  return { summary: layer1Summary(mutated, results, memories), production_equals_reference: plain(results) === plain(replay(mutated, memories)) };
}

export function fixtureFiles() {
  const committed = existsSync(FIXTURES) ? readdirSync(FIXTURES).filter(name => name.endsWith('.json.gz')).sort().map(name => join(FIXTURES, name)) : [];
  const local = [...LOCAL_ONLY].map(project => join(LOCAL_FIXTURES, `${project}.json.gz`)).filter(path => existsSync(path));
  return [...committed, ...local];
}

const cell = value => (value === null || value === undefined ? '-' : String(value));
export function table(project, summary) {
  const lines = [`### ${project}`, '', '| mutation | condition | runs | keys delivered | before first edit | partial | median noise |', '|---|---|---|---|---|---|---|'];
  for (const [mutation, conditions] of Object.entries(summary)) {
    for (const [condition, s] of Object.entries(conditions)) {
      lines.push(`| ${mutation} | ${condition} | ${s.runs} | ${cell(s.keys_delivered_pct)}% of ${s.key_runs} | ${cell(s.keys_before_edit_pct)}% | ${s.keys_partial} | ${cell(s.median_noise)} |`);
    }
  }
  const untriggered = Object.values(Object.values(summary)[0] ?? {})[0]?.untriggered ?? [];
  if (untriggered.length) lines.push('', `No trigger, never replayed: ${untriggered.join(', ')}`);
  return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const writeExpected = process.argv.includes('--write-expected');
  const report = { seed: SEED, mutations: MUTATIONS, projects: {} };
  let ok = true;
  for (const path of fixtureFiles()) {
    const fixture = await loadLayer1(path);
    const out = replayProject(fixture, await memoriesFor(fixture.project));
    ok &&= out.production_equals_reference;
    report.projects[fixture.project] = { runs: fixture.runs.length, committed: !LOCAL_ONLY.has(fixture.project), ...out };
    console.log(`${table(fixture.project, out.summary)}\n\nProduction engine equals reference: ${out.production_equals_reference}\n`);
    if (writeExpected && !LOCAL_ONLY.has(fixture.project)) {
      await writeFile(path.replace(/\.json\.gz$/, '.expected.json'), `${JSON.stringify(out.summary, null, 2)}\n`);
    }
  }
  const target = join(REPO, 'output', 'eval', 'bench-layer1-report.json');
  await mkdir(join(REPO, 'output', 'eval'), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Report: ${target}`);
  if (!ok) process.exitCode = 1;
}
