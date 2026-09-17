---
artifact_class: authored
owner_domain: memory
artifact_type: testing
stability: draft
last_validated: 2026-09-10
depends_on:
  - memory/evidence-ledger.md
used_by:
  - specs/2026-09-10-memory-quality-and-performance-tests.md
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

## V2 Minimum Tests

V2 requires tests proving required behavioral fields, evidence references, typed memory boundaries, admission decisions, trigger retrieval, and anti-memory blocking.

## Benchmark Direction

Later phases may adapt ideas from LongMemEval, LoCoMo and internal task replay. External benchmarks are signals, not substitutes for DD-specific regression tests, and most of them measure a conversational assistant rather than a coding-agent plugin.

## Metrics Catalog

Final QA accuracy is insufficient. The harness instruments:

- **Write-path** — duplicate rate per 1,000 writes; share of writes rejected/downgraded correctly.
- **Evidence** — evidence coverage per durable memory; claim-support precision; rate of unsupported claims.
- **Truth/time** — contradiction rate; unresolved-contradiction time; share of superseded memories still retrieved by error; temporal freshness.
- **Cost/latency** — tokens injected; utility-per-token; p50/p95/p99 retrieval latency.
- **Abstention** — abstention F1 (correctly declining to inject memory).
- **Security** — poisoning resistance; cross-project isolation; source-reliability caps holding under volume (cross-links to `memory-security.md`).

## Benchmark Roster

External benchmarks are signals, not substitutes for DD regression tests: LoCoMo and LongMemEval (extraction, multi-session, temporal, knowledge-update, abstention) are the closest, and neither is representative of plugin use. The deterministic replay harness in `src/eval/` remains the primary regression signal. Fix the metric before measuring: strict token-F1 and LLM-as-judge disagree by tens of points on the same system.

## DeltaDictum concrete catalog

The row-level checklist (what already runs, what the deterioration cut must add, what stays later) lives in `docs/specs/2026-09-10-memory-quality-and-performance-tests.md`. That file is the executable list; this document stays the category/metrics theory.
