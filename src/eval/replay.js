import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createMemoryStore } from '../store/create-store.js';
import { normalizeProposal } from '../engine/contract.js';
import { proposeMemory } from '../engine/write.js';
import { admitMemory, HUMAN_REVIEW } from '../engine/lifecycle.js';
import { retrieveMemories } from '../engine/retrieve.js';
import { estimateTokens } from '../engine/budget.js';
import { triggerJaccard } from '../engine/health/deterioration.js';
import { agreesInDirection, compareScope } from '../engine/v2/admission.js';
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

const PROBE_PROJECT = 'eval-write';
// Pinned, not read from config: the acceptance metric must not improve because a
// project raised the threshold it is measuring.
const MEASUREMENT_JACCARD = 0.5;
// proposeMemory outcomes only. 'admit' is a later review event, not a write attempt.
const WRITE_ATTEMPTS = ['write', 'update', 'ignore', 'block', 'observe'];

// The retrieval fixtures are seeded through putAtom, so they carry no admission
// decisions and no verified evidence. The write-path probe exercises the real
// proposeMemory/admitMemory path over the same authored knowledge, against files
// it writes into the probe repository, so duplicate rate and evidence coverage
// have something truthful to read.
export function writeProbeProposals() {
  return [...MEMORIES, ...NEAR_DUPLICATES].map((memory, i) => ({ ...memory, project_id: PROBE_PROJECT, topic_key: memory.key,
    evidence_refs: [{ source_type: 'file', source_ref: `evidence/${i}.md`,
      summary: `Authored evaluation fixture for ${memory.key}` }] }));
}

// Without these the duplicate rate judges an empty set: the authored corpus holds
// no two memories that say the same thing, so a routing change cannot move a
// number computed over it. Each of the three is a case the routing must get
// right, and the last two are the ones that must NOT be merged.
export const NEAR_DUPLICATES = [
  { key: 'payments/retries/key-reuse', trigger: 'when retrying a payment request',
    behavior_delta: 'Send the original idempotency key again.', why: 'One logical payment is charged once.',
    applies_to: { components: ['payments'] } },
  { key: 'payments/retry/keys', trigger: 'when retrying payment requests',
    behavior_delta: 'Keep using the first idempotency key.', why: 'A second key is a second payment.' },
  { key: 'shipping/retry/idempotency', trigger: 'when retrying payment requests',
    behavior_delta: 'Reuse the original dispatch key.', why: 'A redispatch must not ship twice.',
    applies_to: { components: ['shipping'] } },
  { key: 'payments/retry/never', memory_type: 'anti_memory', trigger: 'when retrying payment requests',
    behavior_delta: 'Do not retry a charge automatically.', why: 'An automatic retry hides the failure.',
    applies_to: { components: ['payments'] } },
  { key: 'tests/clock/fake-timers', trigger: 'when testing time dependent behaviour',
    behavior_delta: 'Pass a clock into the service.', why: 'Tests must control time without sleeps.',
    applies_to: { files: ['src/services/**'] } },
];

export async function runWritePathProbe({ proposals = writeProbeProposals(), missingEvidence = [] } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dd-eval-write-'));
  const repoRoot = join(root, 'repo');
  const store = await createMemoryStore({ ddDir: join(repoRoot, '.dd'), dataDir: join(root, 'data') });
  try {
    for (const ref of new Set(proposals.flatMap(p => p.evidence_refs.map(r => r.source_ref)))) {
      if (missingEvidence.includes(ref)) continue;
      const path = join(repoRoot, ref);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `Evidence fixture for ${ref}
`);
    }
    // Promotion is the local review path; the probe stands in for the human, and
    // only so that "effective" means what it means everywhere else in DD. Each
    // proposal is reviewed before the next arrives, because that is the order
    // real use produces: a memory is effective by the time it is restated weeks
    // later. Reviewing in one batch at the end would leave every peer a
    // candidate, and a candidate is never a revision target.
    for (const proposal of proposals) {
      const result = await proposeMemory(proposal, { store });
      if (!['write', 'update'].includes(result.decision)) continue;
      await admitMemory(result.atom.id, { store, projectId: PROBE_PROJECT, actor: HUMAN_REVIEW,
        rationale: 'Evaluation probe: deterministic local review of an authored fixture.' });
    }
    const decisions = await store.listAdmissions({ projectId: PROBE_PROJECT });
    const attempts = decisions.filter(d => WRITE_ATTEMPTS.includes(d.decision));
    const duplicates = attempts.filter(d => d.decision === 'ignore' && d.reasons.includes('equivalent_knowledge_exists'));
    const effective = await store.listAtoms({ projectId: PROBE_PROJECT, lifecycleStates: ['active', 'contested'] });
    const covered = effective.filter(a => (a.evidence_state?.artifacts ?? []).some(x => x.status === 'verified'));
    // Two rates, because they move in opposite directions and mean different
    // things. Detection counts near-duplicates the write path recognised;
    // survival counts the ones that reached the effective set anyway. Only the
    // second is the problem this stage exists to reduce.
    const detected = attempts.filter(d => d.decision === 'update'
      || d.reasons.includes('suspected_duplicate_pair'));
    let survivingPairs = 0;
    for (let i = 0; i < effective.length; i += 1) {
      for (let j = i + 1; j < effective.length; j += 1) {
        // Opposites are a contradiction, not a duplicate, and DD resolves those
        // through review of a contested pair; they do not belong in this count.
        if (triggerJaccard(effective[i].trigger, effective[j].trigger) >= MEASUREMENT_JACCARD
          && compareScope(effective[i], effective[j]) === 'same'
          && agreesInDirection(effective[i], effective[j])) survivingPairs += 1;
      }
    }
    return {
      write_attempts: attempts.length, duplicates: duplicates.length,
      // Exact equivalence only: sameKnowledge compares serialised authored fields,
      // so paraphrases do not register and this figure understates the problem.
      duplicate_rate_per_1000: attempts.length ? duplicates.length / attempts.length * 1000 : 0,
      near_duplicates_detected: detected.length,
      near_duplicate_detection_rate_per_1000: attempts.length ? detected.length / attempts.length * 1000 : 0,
      // The acceptance number: pairs of effective memories that share a trigger
      // and a scope, meaning a near-duplicate was created and survived review.
      near_duplicate_pairs_surviving: survivingPairs,
      effective_memories: effective.length,
      evidence_coverage: effective.length ? covered.length / effective.length : 0,
    };
  } finally { store.close(); }
}

export async function runReplay({ budget = 600, retrieve = retrieveMemories } = {}) {
  const store = await evaluationStore();
  const rows = [];
  let relevant = 0, returned = 0, expected = 0, exact = 0, tokens = 0;
  // Abstention is scored as its own classification: "returned nothing" is the
  // positive class. Retrieval F1 can hold at 1.0 while this degrades.
  const abstain = { tp: 0, fp: 0, fn: 0 };
  try {
    for (const scenario of CASES) {
      const started = performance.now();
      const result = await retrieve({ ...scenario, project_id: 'eval', budget_tokens: budget, telemetry: false }, { store });
      const ids = result.memories.map(m => m.topic_key);
      const hits = ids.filter(id => scenario.expected.includes(id)).length;
      const reviewCorrect = !scenario.review || result.memories.some(m => m.lifecycle_state === 'review_required');
      relevant += hits; returned += ids.length; expected += scenario.expected.length;
      const shouldAbstain = scenario.expected.length === 0, abstained = ids.length === 0;
      if (abstained && shouldAbstain) abstain.tp += 1;
      else if (abstained) abstain.fp += 1;
      else if (shouldAbstain) abstain.fn += 1;
      const correct = hits === scenario.expected.length && ids.length === hits && reviewCorrect;
      exact += Number(correct); tokens += estimateTokens(result);
      rows.push({ id: scenario.id, correct, expected: scenario.expected, returned: ids, review_correct: reviewCorrect,
        should_abstain: shouldAbstain, abstained,
        tokens: estimateTokens(result), elapsed_ms: Math.round((performance.now() - started) * 100) / 100 });
    }
  } finally { store.close(); }
  const precision = relevant / Math.max(1, returned), recall = relevant / Math.max(1, expected);
  const abstentionPrecision = abstain.tp / Math.max(1, abstain.tp + abstain.fp);
  const abstentionRecall = abstain.tp / Math.max(1, abstain.tp + abstain.fn);
  const staticTokens = CASES.length * estimateTokens(staticContext());
  const write_path = await runWritePathProbe();
  return { kind: 'deterministic_retrieval_replay', cases: CASES.length, exact, precision, recall,
    f1: 2 * precision * recall / Math.max(Number.EPSILON, precision + recall),
    abstention: { expected: abstain.tp + abstain.fn, correct: abstain.tp,
      precision: abstentionPrecision, recall: abstentionRecall,
      f1: 2 * abstentionPrecision * abstentionRecall / Math.max(Number.EPSILON, abstentionPrecision + abstentionRecall) },
    write_path,
    estimated_tokens: { dd: tokens, static_instructions: staticTokens, no_memory: 0,
      reduction_vs_static: 1 - tokens / staticTokens },
    limits: 'Strict set equality against authored ground truth, not LLM-as-judge; the two disagree by tens of points on the same system. Measures conditional retrieval and context cost, not model task success or code quality. Real models require the separate adapter evaluation.', rows };
}

// The existing gate is unchanged; abstention gets its own rather than diluting it.
export function gateFails(report) {
  return report.f1 < 0.9 || report.exact < CASES.length * 0.9 || report.abstention.f1 < 0.9;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runReplay();
  const out = resolve('output/eval/replay.json');
  await mkdir(resolve('output/eval'), { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, rows: undefined, report: out }, null, 2));
  if (gateFails(report)) process.exitCode = 1;
}
