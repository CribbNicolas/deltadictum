#!/usr/bin/env node
// Golden set extraction: real prompts and tool calls from a project's local
// retrieval telemetry, written as bench tasks for a person to label. The bench
// scenarios were written by the same agent that wrote the anchors, so they
// cannot show whether delivery works; labels from real traffic can.
//
// Each event becomes one task marked unlabeled, with what DD delivered for it
// then as a hint. A person sets `must` (and `orbit`) to the topic_keys that
// apply, or leaves `must` empty for an event where nothing should be delivered,
// and removes `unlabeled`. The bench skips tasks still marked unlabeled.
//
//   node src/eval/golden/extract.js --project=<repo> [--data=<data dir>] [--n=100] [--out=<file>]
//   node src/eval/bench/run.js --project=<repo> --scenarios=<file> --provider=semantic
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectDataDir } from '../../project.js';
import { samePath } from '../../paths.js';

const TOOL_CALL = /^([A-Za-z_][\w.-]*) (\{[\s\S]*)$/;
const HOST_CHATTER = /^(<task-notification|<agent-message|Your claude\.ai usage limit)/;
const DD_TOOL = /(^|_)(dd|deltadictum)(_|$)/i;

// The probe a stored action stands for, or null when it is not a request a person
// or the agent made (host notifications, DD's own tools).
export function goldenEvent(action) {
  const text = String(action ?? '').trim();
  if (!text || HOST_CHATTER.test(text)) return null;
  const call = TOOL_CALL.exec(text);
  if (!call) return { prompt: text };
  if (DD_TOOL.test(call[1])) return null;
  try { return { tool: call[1], input: JSON.parse(call[2]) }; }
  catch { return { tool: call[1], input: call[2] }; } // stored actions are truncated
}

// Evenly spaced picks, first included: the same history always gives the same set.
export function sampleEvenly(items, n) {
  if (items.length <= n) return [...items];
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * items.length / n)]);
}

export async function extractGolden({ projectRoot, dataDir, n = 100 }) {
  const db = new DatabaseSync(join(dataDir ?? projectDataDir(projectRoot), 'index.sqlite'), { readOnly: true });
  try {
    const topics = new Map(db.prepare('SELECT id, topic_key FROM memory_atoms').all().map(row => [row.id, row.topic_key]));
    const seen = new Set();
    const events = [];
    for (const row of db.prepare('SELECT action, returned_atom_ids, created_at FROM memory_retrieval_events ORDER BY created_at').all()) {
      const probe = goldenEvent(row.action);
      const key = JSON.stringify(probe);
      if (!probe || seen.has(key)) continue;
      seen.add(key);
      events.push({ probe, at: row.created_at, delivered: JSON.parse(row.returned_atom_ids || '[]').map(id => topics.get(id) ?? id) });
    }
    const prompts = events.filter(e => e.probe.prompt);
    const tools = events.filter(e => e.probe.tool);
    const half = Math.ceil(n / 2);
    const picked = [...sampleEvenly(prompts, Math.min(half, prompts.length)),
      ...sampleEvenly(tools, n - Math.min(half, prompts.length))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    return {
      project: projectRoot,
      note: `Golden set extracted ${new Date().toISOString().slice(0, 10)} from ${events.length} distinct events. `
        + 'Label each task: set must (and orbit) to the topic_keys that apply, or leave must empty when nothing should be delivered, '
        + 'then delete unlabeled. delivered_then is what DD delivered at the time, only as a hint.',
      tasks: picked.map((e, i) => ({ id: `golden-${String(i + 1).padStart(3, '0')}`, unlabeled: true, must: [], orbit: [],
        probes: [e.probe], delivered_then: e.delivered, at: e.at })),
    };
  } finally { db.close(); }
}

if (process.argv[1] && samePath(fileURLToPath(import.meta.url), process.argv[1])) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split(/=(.*)/s)));
  const projectRoot = resolve(args.project ?? process.cwd());
  const golden = await extractGolden({ projectRoot, dataDir: args.data, n: Number(args.n ?? 100) });
  const out = args.out ?? join(projectRoot, '.dd', 'golden.json');
  await writeFile(out, `${JSON.stringify(golden, null, 2)}\n`);
  console.log(`${golden.tasks.length} events to label -> ${out}`);
  process.exit(0);
}
