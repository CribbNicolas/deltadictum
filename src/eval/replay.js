import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createMemoryStore } from '../store/create-store.js';
import { normalizeProposal } from '../engine/contract.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { estimateTokens } from '../engine/budget.js';
import { MEMORIES, CASES } from './cases.js';

export async function evaluationStore() {
  const root = await mkdtemp(join(tmpdir(), 'dd-eval-v2-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  for (const [i, memory] of MEMORIES.entries()) {
    const atom = normalizeProposal({ ...memory, project_id: 'eval', topic_key: memory.key,
      evidence_refs: [{ source_type: 'artifact', source_ref: `fixture:${memory.key}`, summary: 'Authored evaluation fixture' }] });
    await store.putAtom({ ...atom, id: `fixture-${i}`, authority: 'validated', confidence: 0.85,
      lifecycle_state: memory.lifecycle_state ?? 'active', review: { source: 'evaluation_fixture', rationale: 'Ground truth fixture; not production evidence.' } });
  }
  return store;
}

export function staticContext() {
  return MEMORIES.filter(m => m.lifecycle_state !== 'superseded').map(m => ({ topic_key: m.key,
    content: `${m.behavior_delta} Why: ${m.why} Conditions: ${JSON.stringify({ applies_to: m.applies_to, assumptions: m.assumptions, revisit_when: m.revisit_when })}` }));
}

export async function runReplay({ budget = 600 } = {}) {
  const store = await evaluationStore();
  const rows = [];
  let relevant = 0, returned = 0, expected = 0, exact = 0, tokens = 0;
  try {
    for (const scenario of CASES) {
      const started = performance.now();
      const result = await retrieveMemories({ ...scenario, project_id: 'eval', budget_tokens: budget, telemetry: false }, { store });
      const ids = result.memories.map(m => m.topic_key);
      const hits = ids.filter(id => scenario.expected.includes(id)).length;
      const reviewCorrect = !scenario.review || result.memories.some(m => m.lifecycle_state === 'review_required');
      relevant += hits; returned += ids.length; expected += scenario.expected.length;
      const correct = hits === scenario.expected.length && ids.length === hits && reviewCorrect;
      exact += Number(correct); tokens += estimateTokens(result);
      rows.push({ id: scenario.id, correct, expected: scenario.expected, returned: ids, review_correct: reviewCorrect,
        tokens: estimateTokens(result), elapsed_ms: Math.round((performance.now() - started) * 100) / 100 });
    }
  } finally { store.close(); }
  const precision = relevant / Math.max(1, returned), recall = relevant / Math.max(1, expected);
  const staticTokens = CASES.length * estimateTokens(staticContext());
  return { kind: 'deterministic_retrieval_replay', cases: CASES.length, exact, precision, recall,
    f1: 2 * precision * recall / Math.max(Number.EPSILON, precision + recall),
    estimated_tokens: { dd: tokens, static_instructions: staticTokens, no_memory: 0,
      reduction_vs_static: 1 - tokens / staticTokens },
    limits: 'Measures conditional retrieval and context cost, not model task success or code quality. Real models require the separate adapter evaluation.', rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runReplay();
  const out = resolve('output/eval/replay.json');
  await mkdir(resolve('output/eval'), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, rows: undefined, report: out }, null, 2));
  if (report.f1 < 0.9 || report.exact < CASES.length * 0.9) process.exitCode = 1;
}
