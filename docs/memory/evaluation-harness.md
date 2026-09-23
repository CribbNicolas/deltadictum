---
artifact_class: authored
owner_domain: memory
artifact_type: testing
stability: draft
last_validated: 2026-09-18
depends_on:
  - memory/evidence-ledger.md
used_by: []
do_not_co_load_with: []
---

# Evaluation Harness

> Scope: DD is a harness plugin. Everything here operates inside
> [the plugin constraints](../architecture/plugin-constraints.md).

Summary: Memory quality is verified through write-path, read-path, cleanliness, retrieval, safety, and lifecycle tests.

## Success Standard

Memory tests for a promoted phase must reach 100% success rate before the phase is considered complete.

## Test Categories

| Category | What It Proves |
|---|---|
| Write-path validity | Invalid memories are rejected or downgraded before durable write. |
| Cleanliness | Raw `<think>`, markdown fences, empty compactions, and unsanitized model output do not become durable memory. |
| Evidence coverage | Durable memories have valid `evidence_refs` or evidence capsules. |
| Admission quality | Low-utility events are ignored or observed; high-value lessons and anti-memories are admitted. |
| Retrieval activation | Trigger-relevant memories appear before actions. |
| Contradiction safety | Conflicts become contested and do not overwrite canonical memory. |
| Namespace isolation | Retrieval and writes remain project-scoped. |
| Poisoning resistance | Untrusted memory cannot inject higher-priority instructions. |
| Lifecycle correctness | Candidate, active, contested, superseded, archived, and rejected states transition correctly. |

## Minimum Tests

The suite proves required behavioral fields, evidence references, typed memory boundaries, admission decisions, trigger retrieval, and anti-memory blocking.

## Benchmark Direction

Later phases may adapt ideas from LongMemEval, LoCoMo and internal task replay. External benchmarks are signals, not substitutes for DD-specific regression tests, and most of them measure a conversational assistant rather than a coding-agent plugin.

## Metrics Catalog

Final QA accuracy is insufficient. The harness instruments:

- **Write-path** — duplicate rate per 1,000 writes (**implemented**); share of writes rejected/downgraded correctly.
- **Evidence** — evidence coverage per durable memory (**implemented**); claim-support precision; rate of unsupported claims.
- **Truth/time** — contradiction rate; unresolved-contradiction time; share of superseded memories still retrieved by error; temporal freshness.
- **Cost/latency** — tokens injected (**implemented**); utility-per-token; p50/p95/p99 retrieval latency.
- **Abstention** — abstention F1, correctly declining to inject memory (**implemented**).
- **Security** — poisoning resistance; cross-project isolation; source-reliability caps holding under volume (cross-links to `memory-security.md`).

## What `npm run eval` reports, and what each figure means

`src/eval/replay.js` runs two phases against throwaway stores.

**Retrieval phase** — 24 authored scenarios against 7 fixtures seeded through `putAtom`.

| Figure | Definition |
|---|---|
| `exact` | Scenarios where the returned topic-key set equals the expected set exactly, and a `review`-flagged scenario surfaced a `review_required` memory. |
| `precision` / `recall` / `f1` | Micro-averaged over topic keys across all 24 scenarios. |
| `abstention.{precision,recall,f1}` | "Returned nothing" as the positive class. The 9 scenarios expecting `[]` are the positives; a scenario that abstains when it should have injected is a false positive. Scored separately because retrieval F1 can hold at 1.0 while abstention degrades. |
| `estimated_tokens.reduction_vs_static` | Injected tokens against a baseline that loads every non-superseded fixture on every scenario. |

**Write-path phase** (`runWritePathProbe`) — the same authored knowledge proposed through the real
`proposeMemory`, promoted through the real `admitMemory`, against evidence files written into a
temporary repository. The retrieval fixtures cannot supply these figures: they are seeded through
`putAtom`, so they carry no admission decisions and no `evidence_state` at all.

| Figure | Definition |
|---|---|
| `write_path.duplicate_rate_per_1000` | `ignore` decisions with reason `equivalent_knowledge_exists`, over `proposeMemory` outcomes (`write`, `update`, `ignore`, `block`, `observe`), read from `memory_admission_decisions`. `admit` is a later review event and is excluded. |
| `write_path.near_duplicate_detection_rate_per_1000` | `update` decisions plus decisions carrying `suspected_duplicate_pair`, over the same outcomes. Near-duplicates the write path **recognised**. |
| `write_path.near_duplicate_pairs_surviving` | Pairs of effective memories whose triggers overlap at Jaccard ≥ 0.5 with the same scope and the same direction. Near-duplicates that were **created anyway** and reached the effective set. |
| `write_path.evidence_coverage` | Share of effective memories (`active` or `contested`) with at least one `evidence_state.artifacts` entry at `status: 'verified'`. |

The two near-duplicate figures move in opposite directions and must be read together. Detection rising
is the routing starting to see what was always there; survival falling is the only one that means the
store got better. The survival threshold is pinned at 0.5 in `src/eval/replay.js` rather than read from
`config.health.trigger_collision.jaccard`, so raising a project's threshold cannot improve the number
that threshold is being judged by.

### What these numbers cannot tell you

- **The metric is strict set equality against authored ground truth.** It is not LLM-as-judge. The two
  disagree by tens of points on the same system, so a figure from this harness is not comparable to a
  published benchmark number that was scored by a judge.
- **The fixtures are authored alongside the engine and its vocabulary.** This measures conditional
  retrieval and context cost. It does not measure model task success, code quality, or whether a real
  model would have found the same guidance by reading the repository.
- **Duplicate rate catches exact equivalence only.** `sameKnowledge` compares thirteen authored fields
  as serialised JSON, so paraphrases do not register as duplicates. The figure understates the problem
  by construction, which is why the two near-duplicate figures exist beside it. It was `0` over a corpus
  that contained no near-duplicate at all — a rate computed over nothing to detect, which is why the
  corpus now carries `NEAR_DUPLICATES` scenarios.
- **Near-duplicate survival is judged lexically.** The pair count uses trigger Jaccard, scope equality
  and preventive polarity, the same signals the routing itself uses (L3 leaves no others). Two memories
  that restate each other in unrelated words are invisible to both.
- **Sample sizes are single-developer sizes** (L6). 24 scenarios and 12 write-path fixtures are regression signals,
  not statistics. No confidence interval computed over them would mean anything.
- **No latency figure belongs here.** Per-case `elapsed_ms` from the replay is not a percentile; the hot
  path is exercised in `npm run test:stress`.

### CI gate

`npm run eval` exits non-zero when `f1 < 0.9`, `exact < 90%` of scenarios, or `abstention.f1 < 0.9`.
Abstention has its own threshold rather than being folded into the existing one.

## Benchmark Roster

External benchmarks are signals, not substitutes for DD regression tests: LoCoMo and LongMemEval (extraction, multi-session, temporal, knowledge-update, abstention) are the closest, and neither is representative of plugin use. The deterministic replay harness in `src/eval/` remains the primary regression signal. Fix the metric before measuring: strict token-F1 and LLM-as-judge disagree by tens of points on the same system.

