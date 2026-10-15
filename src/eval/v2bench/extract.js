// Builds the v2 bench fixture from the agent trial's recorded runs: each run's
// tool calls as normalized events (spec section 3), the lines it added per file,
// and its per-requirement verdicts. output/eval/ is git-ignored, so the committed
// fixture is what keeps the bench reproducible:
//   node src/eval/v2bench/extract.js [--rows=output/eval/quality.rows.jsonl] [--runs=output/eval/quality-runs]
//     [--judge=output/eval/quality.judge.json] [--out=src/eval/v2bench/fixtures/trial-events.json.gz]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { redactSecrets } from '../../engine/v2/sanitizer.js';
import { bashPaths, relativize, toolEvent as hookEvent } from '../../hooks/v2/events.cjs';
import { TASKS } from '../agent/tasks.js';
import { DEFAULT_FIXTURE } from './fixture.js';

const TEXT_MAX = 2000;
const ADDED_MAX = 16000;
const clip = text => redactSecrets(String(text ?? '')).slice(0, TEXT_MAX);

export { bashPaths, relativize };

// The hook's event (src/hooks/v2/events.cjs), with its text clipped and redacted
// for a committed fixture; null for a tool that carries no project work.
export function toolEvent(name, input, cwd) {
  const event = hookEvent(name, input, cwd);
  return event && 'text' in event ? { ...event, text: clip(event.text) } : event;
}

export function streamEvents(stream) {
  const lines = String(stream ?? '').split('\n').filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const cwd = lines.find(e => e.type === 'system' && e.subtype === 'init')?.cwd ?? '';
  return lines.filter(e => e.type === 'assistant').flatMap(e => e.message?.content ?? [])
    .filter(part => part.type === 'tool_use').map(part => toolEvent(part.name, part.input ?? {}, cwd)).filter(Boolean);
}

// The lines a diff adds, per file, leaving out DD's own store.
export function addedByFile(diff) {
  const added = {};
  let file = null;
  for (const line of String(diff ?? '').split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) { file = header[2].startsWith('.dd/') ? null : header[2]; continue; }
    if (file && line.startsWith('+') && !line.startsWith('+++')) added[file] = `${added[file] ?? ''}${line.slice(1)}\n`;
  }
  return Object.fromEntries(Object.entries(added).map(([path, text]) => [path, redactSecrets(text).slice(0, ADDED_MAX)]));
}

export async function buildFixture({ rows, runsDir, judge }) {
  const judged = new Map((judge?.judgments ?? []).filter(j => !j.error).map(j => [j.run_id, j.requirements]));
  // The last row of a run wins: a recheck rewrites it.
  const latest = new Map(rows.map(row => [row.run_id, row]));
  const runs = [];
  for (const row of latest.values()) {
    const stream = await readFile(join(runsDir, `${row.run_id}.jsonl`), 'utf8').catch(() => null);
    const task = TASKS.find(t => t.id === row.task);
    if (!stream || !task) continue;
    const diff = await readFile(join(runsDir, `${row.run_id}.diff`), 'utf8').catch(() => '');
    runs.push({
      run_id: row.run_id, task: row.task, condition: row.condition ?? (row.dd ? 'dd' : 'none'),
      events: [{ kind: 'prompt', paths: [], text: clip(task.prompt) }, ...streamEvents(stream)],
      verdicts: { ...(row.requirements ?? {}), ...(judged.get(row.run_id) ?? {}) },
      added: addedByFile(diff),
    });
  }
  return { version: 1, tasks: Object.fromEntries(TASKS.map(t => [t.id, { kind: t.kind, memory: t.memory ?? null }])), runs };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  const rows = (await readFile(resolve(REPO, args.rows ?? 'output/eval/quality.rows.jsonl'), 'utf8'))
    .split('\n').filter(Boolean).map(line => JSON.parse(line));
  const judge = JSON.parse(await readFile(resolve(REPO, args.judge ?? 'output/eval/quality.judge.json'), 'utf8').catch(() => 'null'));
  const fixture = await buildFixture({ rows, runsDir: resolve(REPO, args.runs ?? 'output/eval/quality-runs'), judge });
  const out = resolve(REPO, args.out ?? DEFAULT_FIXTURE);
  await mkdir(dirname(out), { recursive: true });
  const bytes = gzipSync(JSON.stringify(fixture));
  await writeFile(out, bytes);
  console.log(JSON.stringify({ runs: fixture.runs.length, events: fixture.runs.reduce((n, r) => n + r.events.length, 0), bytes: bytes.length, out }));
}
