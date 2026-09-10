---
artifact_class: authored
owner_domain: memory
artifact_type: roadmap
stability: draft
last_validated: 2026-06-12
depends_on:
  - memory/memory-v1-to-v10-documentation-design.md
used_by:
  - specs/2026-06-11-memory-v5-authority-registry-design.md
  - memory/behavioral-memory-architecture.md
  - memory/memory-admission-control.md
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
  - memory/memory-orchestrator.md
  - memory/retrieval-router.md
  - memory/evaluation-harness.md
  - memory/contradiction-supersession.md
do_not_co_load_with: []
---

# Memory V1 to V10 Roadmap

Summary: Master roadmap for evolving Orquesta Memory from current structured memory to AGI-memory substrate.

## Thesis

Orquesta Memory does not store information. It governs which experiences become verifiable changes in future agent behavior.

Durable memory exists only when it can answer:

- When does this memory apply?
- What should a future agent do differently because this memory exists?
- What evidence justifies preserving and retrieving it?

## Version Map

| Version | Name | Primary Outcome |
|---|---|---|
| V1 | Current Structured Memory | Existing compaction, dedupe, saliency, Qdrant/Postgres, lifecycle, and basic retrieval are documented as current state. |
| V2 | Behavioral Admission Memory | Admission gate, `trigger`, `behavior_delta`, `evidence_refs`, typed memories, and safe write/read tests. |
| V3 | Evidence-Bearing Memory | Durable memories require evidence, source artifacts, observed time, validity time, and scoped verification. |
| V4 | Trigger-Based Retrieval | Retrieval activates before actions through triggers and multi-resolution forms. |
| V5 | Authority Registry | Canonical topic keys, aliases, renames, controlled vocabularies, and heading proposals. |
| V6a | Contradiction and Supersession Engine (deterministic core) | Same-key supersession, explicit-declaration contradictions, contested lifecycle, predominance store, retrieval surfacing of disputes, Level 3 resolution endpoints. Inference-free. |
| V6b | Contradiction and Supersession Engine (LLM judge) | Background LLM judge, cross-key semantic sweep, auto-scored proposals, stale-decision intelligence, predominance decay. |
| V7 | Hybrid Retrieval Router | Dense, sparse, RRF, temporal, authority, evidence, and intent-routed retrieval. |
| V8 | Conservation and Consolidation | Merge, archival, utility decay, duplicate cleanup, anti-memory generation, and update-don't-append workers. |
| V9 | Federated Local-First Memory | Local/project/org/policy/artifact vaults, privacy, RBAC, and embedding sensitivity controls. |
| V10 | AGI-Memory Substrate | Bitemporal claim ledger, causal memory, multimodal evidence, selective graph/RAPTOR, active learning, and continuous evaluation. |

## V1: Current Structured Memory

V1 is the current implementation baseline. It includes compaction, partial sanitization, `title`, `what`, `why`, `topic_key`, deduplication, saliency, PostgreSQL/Qdrant storage, basic retrieval, and initial lifecycle policies.

V1 is not the future authority. It is the state from which V2 evolves.

## V2: Behavioral Admission Memory

V2 is the next implementation target. It adds an admission gate and requires every durable memory candidate to include `trigger`, `behavior_delta`, and `evidence_refs`.

The initial durable memory types are `observation`, `claim`, `decision`, `lesson`, `anti_memory`, and `procedure`.

V2 must improve behavior immediately by preventing garbage writes, blocking unsafe memory paths, creating anti-memories for repeatable failures, and retrieving operational memories before relevant actions.

## V3: Evidence-Bearing Memory

V3 makes evidence mandatory for durable memory. Observations, artifacts, and durable memories become separate objects with explicit promotion rules.

V3 adds `source_artifact_id`, `observed_at`, `valid_from`, `valid_until`, and scoped evidence validation.

## V4: Trigger-Based Retrieval

V4 shifts retrieval from similarity-only search to action-triggered recall. Before executing an action, the agent asks which memories apply.

Retrieval uses `trigger`, type, scope, lifecycle state, and `micro`, `short`, and `full` forms.

## V5: Authority Registry

V5 introduces library-style authority control for canonical names, aliases, renames, translations, and controlled vocabularies.

The registry prevents naming drift and improves cross-session recall.

## V6: Contradiction and Supersession Engine

V6 introduces contradiction detection, contested states, supersession policies, and stale-decision intelligence. Canonical memories cannot be overwritten by LLM output alone. V6 ships in two batches:

**V6a (deterministic core, shipped).** Same-key supersession, explicitly-declared contradictions, contested lifecycle, decaying predominance store, retrieval surfacing of disputes, and Level 3 resolution endpoints. Fully inference-free. See `memory/contradiction-supersession.md` and `specs/2026-06-18-memory-v6a-contradiction-supersession-design.md`.

**V6b (next).** Background LLM contradiction judge, cross-key semantic sweep, auto-scored resolution proposals held for Level 3 review, stale-decision intelligence worker, and predominance decay.

## V7: Hybrid Retrieval Router

V7 introduces query intent routing and combines dense retrieval, sparse retrieval, RRF, temporal reranking, authority scoring, evidence scoring, and abstention gates.

## V8: Conservation and Consolidation

V8 adds background conservation workers that merge duplicates, archive stale memories, preserve useful lessons, generate anti-memories, and update existing knowledge instead of appending endlessly.

## V9: Federated Local-First Memory

V9 adds local, project, organization, policy, and artifact vaults with explicit privacy, RBAC, export, and embedding-sensitivity policies.

## V10: AGI-Memory Substrate

V10 is the quasi-perfect memory target. It combines bitemporal claim ledgers, causal memory, multimodal evidence, selective graph/RAPTOR retrieval, active learning from misses, continuous evaluation, and auditable governance.

## Phase Boundary Rule

Each phase must be implementable without pretending later phases already exist. V2 documentation may name V3-V10 concepts, but V2 tasks must not require V7 hybrid retrieval, V9 federation, or V10 bitemporal causal memory.

## Phasing Rationale

Implementation order follows three jumps, not feature accumulation:

1. **Reliability jump (V2-V3).** Fix the write path first. Make admission explicit and evidence mandatory. A simple system that stops storing garbage and blocks unsafe writes already changes behavior.
2. **Performance jump (V4-V8).** Add trigger and hybrid retrieval, authority control, contradiction handling, and background conservation. This raises signal-per-token and keeps memory clean as it grows.
3. **Cognitive-ambition jump (V9-V10).** Add federation, privacy, bitemporal causal memory, and continuous evaluation. This is the AGI-memory substrate.

Each jump produces measurable value before the next begins. The first release must prevent repeated errors, warn before dangerous actions, and recall operational memory just in time. A release that only "remembers more" is not the target.

## Design Alternatives Considered

| Alternative | Strength | Limit |
|---|---|---|
| Classic RAG by chunks | Cheap, low latency, good local recall | Weak on multi-hop and global questions; poor temporal coherence |
| Per-session episodic memory | Good for recent, situational context | Duplicates and propagates errors without consolidation |
| Hierarchical summary memory | Good macro-context and abstraction | Can lose detail; irreversible compression risk |
| Graph memory | Strong multi-hop, relations, global themes | Costly to index and maintain |
| Librarian orchestration (chosen direction) | Hybrid, relational, temporal, verifiable; highest upside | Highest engineering and evaluation discipline required |

Orquesta targets librarian orchestration, reached incrementally through the version map rather than built all at once.

## Success Criteria (system-level)

The memory program is "game-changing" when it meets all five:

1. **Written-memory reliability** — less contamination, higher evidence coverage, lower unresolved-contradiction rate.
2. **Benchmark improvement** — gains on memory benchmarks and internal task replay, not just final QA.
3. **Operational efficiency** — fewer injected tokens, lower p95 latency, higher signal per query.
4. **Security and privacy** — red-team resistance to poisoning, leakage, and cross-tenant access.
5. **Human governance** — auditable, editable, understood by the team; never an uncontestable black box.

## Open Questions

- How much compression is safe before evidence is destroyed.
- The right balance between a memory graph and flat hybrid retrieval.
- 2025-2026 sources are largely preprints and self-reported benchmarks; treat them as strong signals, not settled fact.
