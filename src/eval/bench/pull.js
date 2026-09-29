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
import { memoryMap, promptPack, PULL_GUIDANCE } from '../../hooks/session-start.js';
import { preToolPack, preToolRequest } from '../../hooks/pre-tool.js';
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
        const parsed = json ? JSON.parse(json[0]) : {};
        resolve({ get: parsed.get ?? [], retrieve: String(parsed.retrieve ?? '').trim(), cost: reply.total_cost_usd ?? 0 });
      } catch { resolve({ get: [], error: out.slice(0, 300) || 'no output' }); }
    });
  });
}

// What the agent sees at one golden event, as one prompt.
export function pullPrompt({ map, context, probe, pushed, rewrite = false }) {
  const event = probe.prompt ? `The user now says:\n"""\n${probe.prompt.slice(0, 3000)}\n"""`
    : `You are about to call the tool ${probe.tool} with input:\n${JSON.stringify(probe.input).slice(0, 1500)}`;
  return [
    'You are a coding agent working in a software repository. A memory plugin (DD) gave you this at session start:',
    '<session_start>', map, '</session_start>',
    context ? `Earlier in the conversation the user said:\n"""\n${String(context).slice(0, 1500)}\n"""` : '',
    event,
    `With this request DD injected:\n${pushed || '(nothing)'}`,
    'Following DD\'s guidance, which memories would you fetch with the dd `get` tool before acting? List only topic_keys shown above (memory map or pointers) '
      + 'whose line applies to this moment; an empty list is fine. Do not list memories DD already injected in full above. '
      + (rewrite
        ? 'If you would also call the dd `retrieve` tool, put the query text you would send it in "retrieve"; otherwise leave it "". '
          + 'Reply with only JSON: {"get": ["topic/key", ...], "retrieve": "..."}'
        : 'Reply with only JSON: {"get": ["topic/key", ...]}'),
  ].filter(Boolean).join('\n\n');
}

const mean = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

// rewrite: the model may also ask for a retrieve with the task in English, as the
// pull guidance tells it to; its memories count as pulled.
// withMap: false leaves the memory map out, as it is far back in a real session's
// context by the time most events happen: only the pushed pack and its pointers
// sit next to the event. With the map the result is an upper bound.
export async function runPullBench({ projectRoot, scenarios, retrieve, split, model = 'haiku', runs = 1, concurrency = 6, rewrite = false, withMap = true }) {
  const dir = await mkdtemp(join(tmpdir(), 'dd-pull-'));
  await writeFile(join(dir, 'settings.json'), '{"disableAllHooks":true}');
  await writeFile(join(dir, 'mcp.json'), '{"mcpServers":{}}');
  const opened = await openBenchStore(projectRoot);
  const { store, projectId } = opened;
  const jobs = [];
  const summaries = [];
  try {
    const live = await store.listAtoms({ projectId, lifecycleStates: ['active', 'contested'] });
    // What get accepts: a topic_key, an id, or the id prefix pointers and headlines show.
    const byTopic = new Map(live.map(atom => [atom.topic_key, atom.id]));
    const topics = { get: key => byTopic.get(key) ?? live.find(atom => String(key).length >= 8 && atom.id.startsWith(String(key)))?.id };
    const map = withMap ? `${PULL_GUIDANCE}\n\n${memoryMap(live)}` : PULL_GUIDANCE;
    for (const task of scenarios.tasks.filter(task => !task.unlabeled && inSplit(task, split))) {
      const probe = task.probes[0];
      const request = probe.prompt ? { action: probe.prompt, source: 'prompt' }
        : { ...preToolRequest({ tool_name: probe.tool, tool_input: probe.input }), source: 'tool' };
      if (!request.action) continue;
      const result = await retrieve({ project_id: projectId, ...request, telemetry: false, repeat: true }, { store });
      // Exactly what the hooks inject for this event.
      const pushed = probe.prompt ? promptPack(result, probe.prompt) : preToolPack(result);
      jobs.push({ task, pushed: new Set((result.memories ?? []).map(m => m.id)), pointers: result.pointers?.length ?? 0,
        prompt: pullPrompt({ map, context: task.context, probe, pushed, rewrite }) });
    }
    for (let run = 0; run < runs; run += 1) {
      let next = 0;
      const answers = new Array(jobs.length);
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < jobs.length) {
          const i = next++;
          const answer = await askModel(jobs[i].prompt, { model, dir });
          answer.retrieved = [];
          if (rewrite && answer.retrieve) {
            // The retrieve tool's answer, as MCP returns it: memories and pointers.
            // The agent reads it and may get what its pointers name.
            const found = await retrieve({ project_id: projectId, action: answer.retrieve, source: 'prompt', explicit: true, telemetry: false, repeat: true }, { store });
            answer.retrieved = (found.memories ?? []).map(m => m.id);
            if (found.pointers?.length) {
              const followUp = await askModel([jobs[i].prompt, `You called retrieve("${answer.retrieve}"). It returned:\n${promptPack(found, '')}`,
                'Which of the memories it points at would you now fetch with `get`? Reply with only JSON: {"get": ["topic/key", ...]}'].join('\n\n'), { model, dir });
              answer.get = [...(answer.get ?? []), ...(followUp.get ?? [])];
              answer.cost = (answer.cost ?? 0) + (followUp.cost ?? 0);
            }
          }
          answers[i] = answer;
        }
      }));
      const rows = jobs.map(({ task, pushed, pointers }, i) => {
        const must = new Set(task.must.map(t => topics.get(t)).filter(Boolean));
        const orbit = new Set((task.orbit ?? []).map(t => topics.get(t)).filter(Boolean));
        const pulled = new Set([...(answers[i].get ?? []).map(t => topics.get(t)).filter(Boolean), ...answers[i].retrieved]);
        const hits = set => [...must].filter(id => set.has(id)).length;
        return { id: task.id, negative: must.size === 0, must: must.size, push: hits(pushed), both: hits(new Set([...pushed, ...pulled])),
          pushed: pushed.size, pointers, pulled: pulled.size, noise: [...pulled].filter(id => !must.has(id) && !orbit.has(id)).length,
          pushed_ids: [...pushed], get: answers[i].get, retrieve: answers[i].retrieve, cost: answers[i].cost ?? 0, error: answers[i].error };
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
        pointers_per_event: mean(rows.map(r => r.pointers)), pulled_per_event: mean(rows.map(r => r.pulled)), pulled_noise_per_event: mean(rows.map(r => r.noise)),
        retrieves_per_event: mean(rows.map(r => r.retrieve ? 1 : 0)), cost_usd_list: rows.reduce((a, r) => a + r.cost, 0),
        rows,
      });
    }
  } finally { await opened.close(); await rm(dir, { recursive: true, force: true }); }
  return summaries;
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split(/=(.*)/s)));
  const scenarios = JSON.parse(await readFile(args.scenarios, 'utf8'));
  const retrieve = (await import('../../semantic/provider.js')).createSemanticRetrieve();
  const summaries = await runPullBench({ projectRoot: args.project ?? process.cwd(), scenarios, retrieve, split: args.split,
    model: args.model ?? 'haiku', runs: Number(args.runs ?? 1), concurrency: Number(args.conc ?? 6), rewrite: args.rewrite === '1', withMap: args.map !== '0' });
  if (args.out) await writeFile(args.out, JSON.stringify(summaries, null, 1));
  for (const { rows, ...summary } of summaries) console.log(JSON.stringify(summary));
  process.exit(0);
}
