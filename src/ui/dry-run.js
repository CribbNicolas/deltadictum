import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readFootprint } from '../capture/footprint.js';
import { compileIndex } from '../engine/compile.js';
import { localPaths } from '../engine/locate.cjs';
import { matchEvent, prepareIndex } from '../engine/match.cjs';

// "In which recent sessions, at which event, would this memory have fired?"
// (spec section 8), over the footprints still on disk. Footprints keep paths,
// commands, search patterns and identifiers, never prompts: a clause on prompt
// keywords cannot be judged here, and the result says so instead of reporting 0.
const EVENT_MAX = 200;

export function dryRun(root, triggers) {
  const draft = { id: 'draft', topic: 'draft/draft', kind: 'trap', status: 'active', title: 'draft', body: 'draft', evidence: [], triggers };
  const runtime = prepareIndex(compileIndex({ memories: [draft], manifest: { count: 1, hash: 'draft' } }).index);
  let names = [];
  try { names = readdirSync(localPaths(root).sessions).filter(name => name.endsWith('.footprint.jsonl')); } catch { /* none recorded */ }
  const events = [];
  const fired = new Set();
  for (const name of names) {
    const session = name.split('.')[0];
    for (const entry of readFootprint(join(localPaths(root).sessions, name))) {
      if (entry.t !== 'tool') continue;
      const event = { kind: entry.kind, paths: entry.paths ?? [], text: entry.command ?? entry.pattern ?? (entry.identifiers ?? []).join(' ') };
      const [hit] = matchEvent(runtime, event);
      if (!hit) continue;
      fired.add(session);
      if (events.length < EVENT_MAX) events.push({ session, at: entry.at ?? null, kind: entry.kind, paths: event.paths, via: hit.via });
    }
  }
  const unjudged = triggers.some(clause => clause.on?.includes('prompt') && clause.keywords?.length) ? ['prompt keywords: footprints keep no prompt text'] : [];
  return { scanned: names.length, sessions: fired.size, events, unjudged };
}
