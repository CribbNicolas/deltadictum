// Layer 1's mutations of a recorded run (spec "Two layers"): the same work reached another way, to
// see which deliveries depend on the exact trace. Each is pure and seeded.
import { createHash } from 'node:crypto';

export const MUTATIONS = ['none', 'no-prompt', 'reads-shuffled', 'sibling-paths'];

const LOOKS = ['read', 'search'];
const FILE = /^((?:.*\/)?)([^/]+\.[^/.]+)$/;

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The reads and searches before the first edit or write, permuted among their own positions.
function shuffleReads(events, random) {
  const firstChange = events.findIndex(e => e.kind === 'edit' || e.kind === 'write');
  const end = firstChange < 0 ? events.length : firstChange;
  const slots = events.slice(0, end).flatMap((event, i) => (LOOKS.includes(event.kind) ? [i] : []));
  const moved = slots.map(i => events[i]);
  for (let i = moved.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [moved[i], moved[j]] = [moved[j], moved[i]];
  }
  const out = [...events];
  slots.forEach((slot, k) => { out[slot] = moved[k]; });
  return out;
}

// A file in the same folder that is not the one recorded: a memory scoped to the file stops firing,
// one scoped to the folder keeps firing.
const sibling = path => path.replace(FILE, '$1zz-sibling-$2');

export function mutateRun(run, mutation, seed) {
  if (!MUTATIONS.includes(mutation)) throw new Error(`unknown mutation: ${mutation}`);
  const run_id = `${run.run_id}~${mutation}`;
  if (mutation === 'none') return { ...run, run_id };
  if (mutation === 'no-prompt') return { ...run, run_id, events: run.events.filter(e => e.kind !== 'prompt') };
  if (mutation === 'sibling-paths') return { ...run, run_id, events: run.events.map(e => ({ ...e, paths: e.paths.map(sibling) })) };
  const state = createHash('sha256').update(`${seed}\0${run.run_id}`).digest().readUInt32BE(0);
  return { ...run, run_id, events: shuffleReads(run.events, mulberry32(state)) };
}
