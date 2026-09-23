#!/usr/bin/env node
// Task-level retrieval benchmark over a real project's store.
//
// Each task is a sequence of probes in one session, shaped exactly as the hooks
// shape them: a user prompt (UserPromptSubmit) or a tool call (PreToolUse, via
// preToolRequest). What the agent would have received over the whole task is
// scored against the memories the task needs (must) and those useful around it
// (orbit). Two providers answer the same probes: 'lexical' (prod-a, what hooks
// run without the resident process) and 'semantic' (prod-b).
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createMemoryStore } from '../../store/create-store.js';
import { retrieveMemories } from '../../engine/retrieve.js';
import { preToolRequest } from '../../hooks/pre-tool.js';
import { microPack } from '../../hooks/session-start.js';
import { estimateTokens } from '../../engine/budget.js';
import { looksNonEnglish } from '../../engine/language.js';
import { samePath } from '../../paths.js';
import { fileURLToPath } from 'node:url';

export async function openBenchStore(projectRoot) {
  // A copy of the project's knowledge, so the run never writes to it. The repo
  // root stays the real one, so evidence freshness reflects the working tree.
  const scratch = await mkdtemp(join(tmpdir(), 'dd-bench-'));
  await cp(join(projectRoot, '.dd'), join(scratch, '.dd'), { recursive: true,
    filter: source => !/[\\/](data|local)([\\/]|$)|ui\.json$/.test(source) });
  const store = await createMemoryStore({ ddDir: join(scratch, '.dd'), dataDir: join(scratch, 'data'), repoRoot: resolve(projectRoot) });
  const projectId = (await store.loadConfig()).project_id;
  return { store, projectId, close: async () => { store.close(); await rm(scratch, { recursive: true, force: true }); } };
}

function probeRequest(probe) {
  if (probe.prompt) return { kind: looksNonEnglish(probe.prompt) ? 'prompt_es' : 'prompt_en', request: { action: probe.prompt } };
  return { kind: 'tool', request: preToolRequest({ tool_name: probe.tool, tool_input: probe.input }) };
}

const ratio = (num, den) => den ? num / den : null;
const mean = values => { const known = values.filter(v => v !== null); return known.length ? known.reduce((a, b) => a + b, 0) / known.length : null; };

export async function runBench({ projectRoot, scenarios, retrieve = retrieveMemories, provider = 'lexical', store: given } = {}) {
  const opened = given ? { ...given, close: async () => {} } : await openBenchStore(projectRoot);
  const { store, projectId } = opened;
  const atoms = await store.listAtoms({ projectId, lifecycleStates: ['active', 'contested'] });
  const history = await store.listAtoms({ projectId, lifecycleStates: ['superseded', 'archived', 'rejected'] }).catch(() => []);
  // Labels name the memory that was live when the scenario was written. A revised
  // memory keeps its topic_key, so a label follows its topic to the live version.
  const full = prefix => {
    const live = atoms.find(atom => atom.id.startsWith(prefix));
    if (live) return live.id;
    const topic = history.find(atom => atom.id.startsWith(prefix))?.topic_key;
    return atoms.find(atom => topic && atom.topic_key === topic)?.id ?? `missing:${prefix}`;
  };
  const tasks = [];
  const probeRows = [];
  try {
    for (const task of scenarios.tasks) {
      const must = new Set(task.must.map(full));
      const orbit = new Set(task.orbit.map(full));
      const session = `bench-${provider}-${task.id}-${Date.now()}`;
      const delivered = new Set();
      let tokens = 0;
      for (const probe of task.probes) {
        const { kind, request } = probeRequest(probe);
        if (!request) continue;
        const result = await retrieve({ project_id: projectId, ...request, session_id: session, telemetry: false }, { store });
        const ids = (result.memories ?? []).map(m => m.id);
        ids.forEach(id => delivered.add(id));
        if (ids.length) tokens += estimateTokens(microPack(result.memories));
        // Per-probe view, without session dedup: what this probe alone recalls.
        const alone = await retrieve({ project_id: projectId, ...request, telemetry: false, repeat: true }, { store });
        const aloneIds = new Set((alone.memories ?? []).map(m => m.id));
        probeRows.push({ task: task.id, kind, must: [...must].filter(id => aloneIds.has(id)).length, must_total: must.size,
          relevant: [...aloneIds].filter(id => must.has(id) || orbit.has(id)).length, returned: aloneIds.size });
      }
      const got = [...delivered];
      const mustHit = got.filter(id => must.has(id)).length;
      const orbitHit = got.filter(id => orbit.has(id)).length;
      tasks.push({ id: task.id, negative: must.size === 0, must_recall: ratio(mustHit, must.size), orbit_recall: ratio(orbitHit, orbit.size),
        precision: ratio(mustHit + orbitHit, got.length), returned: got.length, tokens,
        missed: [...must].filter(id => !delivered.has(id)).map(id => id.slice(0, 8)),
        noise: got.filter(id => !must.has(id) && !orbit.has(id)).map(id => id.slice(0, 8)) });
    }
  } finally { await opened.close(); }
  const positive = tasks.filter(t => !t.negative);
  const negative = tasks.filter(t => t.negative);
  const byKind = kind => { const rows = probeRows.filter(r => r.kind === kind && r.must_total);
    return { probes: rows.length, must_recall: mean(rows.map(r => r.must / r.must_total)), precision: mean(rows.map(r => ratio(r.relevant, r.returned))) }; };
  return {
    provider,
    summary: {
      must_recall: mean(positive.map(t => t.must_recall)), orbit_recall: mean(positive.map(t => t.orbit_recall)),
      precision: mean(positive.map(t => t.precision)),
      negatives_quiet: negative.filter(t => t.returned === 0).length + '/' + negative.length,
      tokens_per_task: mean(tasks.map(t => t.tokens)),
      by_probe: { prompt_en: byKind('prompt_en'), prompt_es: byKind('prompt_es'), tool: byKind('tool') },
    },
    tasks,
  };
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const projectRoot = args.project ?? process.cwd();
  const scenarios = JSON.parse(await readFile(args.scenarios ?? new URL('./supermem.scenarios.json', import.meta.url), 'utf8'));
  let retrieve = retrieveMemories;
  if (args.provider === 'semantic') retrieve = (await import('../../semantic/provider.js')).createSemanticRetrieve();
  const report = await runBench({ projectRoot, scenarios, retrieve, provider: args.provider ?? 'lexical' });
  console.log(JSON.stringify(args.full ? report : report.summary, null, 1));
  if (!args.full) for (const t of report.tasks) console.log(t.id.padEnd(36), 'must', t.must_recall?.toFixed(2) ?? '-', 'orbit', t.orbit_recall?.toFixed(2) ?? '-',
    'prec', t.precision?.toFixed(2) ?? '-', 'n', t.returned, 'tok', t.tokens, t.missed.length ? 'MISSED ' + t.missed.join(',') : '', t.noise.length ? 'noise ' + t.noise.join(',') : '');
  process.exit(0);
}
