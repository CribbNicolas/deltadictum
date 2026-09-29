#!/usr/bin/env node
// Pull-path benchmark. run.js scores only what DD pushes; the memory map and the
// pointers exist so the agent pulls the rest with `get`. This asks a real model
// what it would pull for each golden event, given what the agent would see (the
// pull guidance, the memory map, the event, the pushed pack), and scores push
// alone against push plus pull.
//
// It runs `claude -p` with hooks, MCP servers and tools off, so the answer comes
// from the context given here alone. Models are not deterministic: on the golden
// sets (2026-09-28) two runs of the same map differed by up to 4 events of 29, so
// compare changes over several runs (--runs).
//
//   node src/eval/bench/pull.js --project=<repo> --scenarios=<golden.json> [--split=test] [--model=haiku] [--runs=1] [--conc=6]
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openBenchStore, inSplit } from './run.js';
import { memoryMap, microPack, pointerPack, PULL_GUIDANCE } from '../../hooks/session-start.js';
import { preToolRequest } from '../../hooks/pre-tool.js';
import { samePath } from '../../paths.js';

function askModel(prompt, { model, dir }) {
  return new Promise(resolve => {
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', ['-p', '--model', model, '--settings', join(dir, 'settings.json'),
      '--strict-mcp-config', '--mcp-config', join(dir, 'mcp.json'), '--tools', '', '--no-session-persistence', '--output-format', 'json'],
      { cwd: dir });
    let out = '';
    child.on('error', err => resolve({ get: [], error: String(err) }));
    child.stdout.on('data', chunk => { out += chunk; });
    child.stdin.end(prompt);
    child.on('close', () => {
      try {
        const reply = JSON.parse(out);
        const json = /\{[\s\S]*"get"[\s\S]*\}/.exec(reply.result ?? '');
        resolve({ get: json ? JSON.parse(json[0]).get ?? [] : [], cost: reply.total_cost_usd ?? 0 });
      } catch { resolve({ get: [], error: out.slice(0, 300) || 'no output' }); }
    });
  });
}

// What the agent sees at one golden event, as one prompt.
export function pullPrompt({ map, context, probe, pushed }) {
  const event = probe.prompt ? `The user now says:\n"""\n${probe.prompt.slice(0, 3000)}\n"""`
    : `You are about to call the tool ${probe.tool} with input:\n${JSON.stringify(probe.input).slice(0, 1500)}`;
  return [
    'You are a coding agent working in a software repository. A memory plugin (DD) gave you this at session start:',
    '<session_start>', map, '</session_start>',
    context ? `Earlier in the conversation the user said:\n"""\n${String(context).slice(0, 1500)}\n"""` : '',
    event,
    `With this request DD injected:\n${pushed || '(nothing)'}`,
    'Following DD\'s guidance, which memories would you fetch with the dd `get` tool before acting? List only topic_keys from the memory map '
      + 'whose line applies to this moment; an empty list is fine. Do not list memories DD already injected in full above. '
      + 'Reply with only JSON: {"get": ["topic/key", ...]}',
  ].filter(Boolean).join('\n\n');
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

export async function runPullBench({ projectRoot, scenarios, retrieve, split, model = 'haiku', runs = 1, concurrency = 6 }) {
  const dir = await mkdtemp(join(tmpdir(), 'dd-pull-'));
  await writeFile(join(dir, 'settings.json'), '{"disableAllHooks":true}');
  await writeFile(join(dir, 'mcp.json'), '{"mcpServers":{}}');
  const opened = await openBenchStore(projectRoot);
  const { store, projectId } = opened;
  const jobs = [];
  let topics;
  try {
    const live = await store.listAtoms({ projectId, lifecycleStates: ['active', 'contested'] });
    topics = new Map(live.map(atom => [atom.topic_key, atom.id]));
    const map = `${PULL_GUIDANCE}\n\n${memoryMap(live)}`;
    for (const task of scenarios.tasks.filter(task => !task.unlabeled && inSplit(task, split))) {
      const probe = task.probes[0];
      const request = probe.prompt ? { action: probe.prompt, source: 'prompt' }
        : { ...preToolRequest({ tool_name: probe.tool, tool_input: probe.input }), source: 'tool' };
      if (!request.action) continue;
      const result = await retrieve({ project_id: projectId, ...request, telemetry: false, repeat: true }, { store });
      const pushed = [microPack(result.memories ?? []), pointerPack(result.pointers)].filter(Boolean).join('\n');
      jobs.push({ task, pushed: new Set((result.memories ?? []).map(m => m.id)), prompt: pullPrompt({ map, context: task.context, probe, pushed }) });
    }
  } finally { await opened.close(); }
  const summaries = [];
  try {
    for (let run = 0; run < runs; run += 1) {
      let next = 0;
      const answers = new Array(jobs.length);
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < jobs.length) { const i = next++; answers[i] = await askModel(jobs[i].prompt, { model, dir }); }
      }));
      const rows = jobs.map(({ task, pushed }, i) => {
        const must = new Set(task.must.map(t => topics.get(t)).filter(Boolean));
        const orbit = new Set((task.orbit ?? []).map(t => topics.get(t)).filter(Boolean));
        const pulled = new Set((answers[i].get ?? []).map(t => topics.get(t)).filter(Boolean));
        const hits = set => [...must].filter(id => set.has(id)).length;
        return { id: task.id, negative: must.size === 0, must: must.size, push: hits(pushed), both: hits(new Set([...pushed, ...pulled])),
          pushed: pushed.size, pulled: pulled.size, noise: [...pulled].filter(id => !must.has(id) && !orbit.has(id)).length,
          cost: answers[i].cost ?? 0, error: answers[i].error };
      });
      const positive = rows.filter(r => !r.negative);
      const negative = rows.filter(r => r.negative);
      summaries.push({
        run: run + 1, events: rows.length, errors: rows.filter(r => r.error).length,
        must_recall_push: mean(positive.map(r => r.push / r.must)), must_recall_push_pull: mean(positive.map(r => r.both / r.must)),
        complete_push: `${positive.filter(r => r.push === r.must).length}/${positive.length}`,
        complete_push_pull: `${positive.filter(r => r.both === r.must).length}/${positive.length}`,
        negatives_quiet_push: `${negative.filter(r => !r.pushed).length}/${negative.length}`,
        negatives_no_pull: `${negative.filter(r => !r.pulled).length}/${negative.length}`,
        pulled_per_event: mean(rows.map(r => r.pulled)), pulled_noise_per_event: mean(rows.map(r => r.noise)),
        cost_usd_list: rows.reduce((a, r) => a + r.cost, 0),
      });
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
  return summaries;
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split(/=(.*)/s)));
  const scenarios = JSON.parse(await readFile(args.scenarios, 'utf8'));
  const retrieve = (await import('../../semantic/provider.js')).createSemanticRetrieve();
  const summaries = await runPullBench({ projectRoot: args.project ?? process.cwd(), scenarios, retrieve, split: args.split,
    model: args.model ?? 'haiku', runs: Number(args.runs ?? 1), concurrency: Number(args.conc ?? 6) });
  for (const summary of summaries) console.log(JSON.stringify(summary));
  process.exit(0);
}
