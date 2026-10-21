// Layer 1 of the full benchmark: the tool
// calls each layer-2 run made, as the hook's events, grouped by project. A committed fixture names no
// clone, user or machine: paths come out repository-relative, a path outside the clone is dropped, and
// text names the clone as `.`. Patriark is another owner's repository, so its traces stay in output/eval:
//   node src/eval/bench/layer1/extract.js [--runs=bench-2026-10/haiku,bench-2026-10/opus]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { addedByFile, toolEvent } from '../../replay/extract.js';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const REPO = resolve(fileURLToPath(new URL('../../../..', import.meta.url)));
export const LOCAL_FIXTURES = join(REPO, 'output', 'eval', 'bench', 'layer1');
// Projects whose files supermem may not hold: their fixture is generated, never committed.
export const LOCAL_ONLY = new Set(['patriark']);

const ABSOLUTE = /^(?:[A-Za-z]:)?\/|^~/;
const CLONE = /^(.*?[\\/]dd-bench-[^\\/]+[\\/][^\\/]+)/;
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text with the clone named `.`, any other temporary bench folder as <tmp> and a home folder as ~.
function scrubber(root) {
  const clone = root ? new RegExp(root.replace(/[\\/]+$/, '').split(/[\\/]+/).map(escape).join('[\\\\/]+'), 'gi') : null;
  return text => {
    let out = String(text ?? '');
    if (clone) out = out.replace(clone, '.');
    return out.replace(/[^\s"'`]*dd-bench-[^\s"'`]*/g, '<tmp>')
      .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s"'`]+/gi, '~')
      .replace(/(?:\/[A-Za-z](?=\/))?\/(?:Users|home)\/[^/\s"'`]+/g, '~');
  };
}

const parse = stream => String(stream ?? '').split('\n').filter(Boolean)
  .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);

// The run's events: the clone is the init event's cwd, or, in a stream without one, the bench
// folder a tool path names.
export function runEvents(stream) {
  const lines = parse(stream);
  const calls = lines.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? []).filter(part => part.type === 'tool_use');
  const named = calls.flatMap(part => [part.input?.file_path, part.input?.path, part.input?.notebook_path])
    .map(value => CLONE.exec(String(value ?? ''))?.[1]).find(Boolean);
  const root = lines.find(e => e.type === 'system' && e.subtype === 'init')?.cwd ?? named ?? '';
  const scrub = scrubber(root);
  const events = calls.map(part => toolEvent(part.name, part.input ?? {}, root)).filter(Boolean).map(event => ({
    ...event,
    paths: event.paths.filter(path => !ABSOLUTE.test(path) && !path.includes('dd-bench-')),
    ...('text' in event ? { text: scrub(event.text) } : {}),
  }));
  return { events, scrub };
}

// sources: one per model directory, each { rows, runsDir, judge? }. A run is named by its model and
// its row's run_id, since both models ran the same run ids.
export async function extractTraces({ sources, tasks }) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const traces = new Map();
  for (const { rows, runsDir, judge } of sources) {
    const judged = new Map((judge?.judgments ?? []).filter(j => !j.error).map(j => [j.run_id, j.requirements]));
    // The last row of a run wins: a recheck rewrites it.
    const latest = new Map(rows.map(row => [row.run_id, row]));
    for (const row of latest.values()) {
      const task = byId.get(row.task);
      const stream = task ? await readFile(join(runsDir, `${row.run_id}.jsonl`), 'utf8').catch(() => null) : null;
      if (!stream) continue;
      const { events, scrub } = runEvents(stream);
      const diff = await readFile(join(runsDir, `${row.run_id}.diff`), 'utf8').catch(() => '');
      if (!traces.has(task.project)) {
        traces.set(task.project, { version: 2, project: task.project, tasks: Object.fromEntries(tasks.filter(t => t.project === task.project)
          .map(t => [t.id, { kind: t.kind, situation: t.situation, memories: t.memories ?? [] }])), runs: [] });
      }
      traces.get(task.project).runs.push({
        run_id: `${row.model}/${row.run_id}`, model: row.model, task: row.task, condition: row.condition,
        events: [{ kind: 'prompt', paths: [], text: scrub(task.prompt) }, ...events],
        verdicts: { ...(row.requirements ?? {}), ...(judged.get(row.run_id) ?? {}) },
        added: Object.fromEntries(Object.entries(addedByFile(diff)).map(([path, text]) => [path, scrub(text)])),
      });
    }
  }
  for (const fixture of traces.values()) fixture.runs.sort((a, b) => (a.run_id < b.run_id ? -1 : a.run_id > b.run_id ? 1 : 0));
  return traces;
}

export const fixturePath = project => (LOCAL_ONLY.has(project) ? join(LOCAL_FIXTURES, `${project}.json.gz`) : join(FIXTURES, `${project}.json.gz`));

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const { TASKS } = await import('../tasks.js');
  const sources = [];
  for (const dir of (args.runs ?? 'bench-2026-10/haiku,bench-2026-10/opus').split(',')) {
    const base = resolve(REPO, 'output', 'eval', dir);
    const rows = (await readFile(join(base, 'results.rows.jsonl'), 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
    const judge = JSON.parse(await readFile(join(base, 'results.judge.json'), 'utf8').catch(() => 'null'));
    sources.push({ rows, runsDir: join(base, 'runs'), judge });
  }
  for (const [project, fixture] of await extractTraces({ sources, tasks: TASKS })) {
    const out = fixturePath(project);
    await mkdir(dirname(out), { recursive: true });
    const bytes = gzipSync(JSON.stringify(fixture));
    await writeFile(out, bytes);
    console.log(JSON.stringify({ project, runs: fixture.runs.length, events: fixture.runs.reduce((n, r) => n + r.events.length, 0), bytes: bytes.length, out }));
  }
}
