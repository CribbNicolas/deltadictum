import { memoryMatch } from '../../engine/clause.cjs';

const LIVE = ['active', 'contested'];

// The engine the bench drives: prepare once per memory set, then say which
// memories fire on one event. The reference engine evaluates every clause of every
// live memory; the compiled matcher of plan 2 must give the same answers.
export const referenceEngine = {
  prepare: memories => memories.filter(memory => LIVE.includes(memory.status)),
  fire: (live, event) => live.flatMap(memory => {
    const hit = memoryMatch(memory, event);
    return hit ? [{ id: memory.id, via: hit.via }] : [];
  }),
};

// Each run replayed through the engine with a session ledger: a memory is
// delivered the first time it fires in the run and never again.
export function replay(fixture, memories, engine = referenceEngine) {
  const state = engine.prepare(memories);
  return fixture.runs.map(run => {
    const delivered = new Map();
    run.events.forEach((event, index) => {
      for (const hit of engine.fire(state, event)) {
        if (!delivered.has(hit.id)) delivered.set(hit.id, { at: index, kind: event.kind, via: hit.via });
      }
    });
    return { run_id: run.run_id, task: run.task, condition: run.condition, delivered };
  });
}
