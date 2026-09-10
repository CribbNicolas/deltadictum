---
artifact_class: authored
owner_domain: memory
artifact_type: interface
stability: draft
last_validated: 2026-06-11
depends_on:
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
used_by:
  - runtime/retrieval-injection.md
  - memory/evaluation-harness.md
  - specs/2026-06-11-memory-v4-trigger-retrieval-design.md
do_not_co_load_with: []
---

# Retrieval Router

Summary: Memory retrieval evolves from semantic top-k to trigger, intent, evidence, and budget-aware routing.

## Retrieval Principle

The system should not only ask what is semantically similar. It should ask what memory should activate before this action.

## V4 Read Path

```text
task/action/query
-> classify action or intent
-> retrieve by trigger + keyword + embedding + relations
-> filter by project, scope, lifecycle, authority, TTL
-> verify evidence and contradictions
-> assemble micro, short, or full forms
-> inject only if value_per_token exceeds threshold
```

v1 SuperMem implements the **keyword + trigger + budget** slice only (SQLite FTS5 candidate gen, then trigger score, compact forms, max 8 hits). Embeddings, RRF, and GraphRAG stay deferred. See `docs/specs/2026-09-09-retrieval-hot-path-and-scale.md`.

## Intent Classes

The router eventually supports factual, temporal, global, causal, policy, debug, and abstention-oriented queries.

## Hybrid Retrieval

V7 combines dense retrieval, sparse retrieval, reciprocal-rank fusion, temporal reranking, authority/evidence scoring, and low-confidence abstention.

## Budgeted Forms

`micro` is used for activation and warnings. `short` is used for normal context injection. `full` is fetched only when the task requires evidence or detailed rationale.

## Hybrid Retrieval Components

Modern retrieval is not "dense embeddings + ANN". The router combines:

- **Dense + sparse/BM25** candidate generation, optionally multi-vector. BGE-M3 unifies dense, sparse, and multi-vector in one multilingual model, which fits Orquesta's Spanish/English usage.
- **Reciprocal-rank fusion (RRF)** to merge candidate lists, followed by a reranker using dense, sparse, temporal, and authority features.
- **Late chunking** — encode the long document first, chunk after, to preserve signal that pre-chunk encoding destroys.
- **Low-confidence abstention** — reject injection when support is weak rather than inject noise.

## Context-Assembly Discipline

A large context window does not mean the window is used well: relevant evidence placed in the middle of a long context is under-used (Lost-in-the-Middle). Assembly therefore prefers compact, well-ordered `micro`/`short` forms over dumping `full` bodies.

## Intent Classes and Corrective Retrieval

The intent classifier routes factual, temporal, global, causal, policy, debug, and abstention queries to different profiles. Corrective and self-reflective retrieval (CRAG, Self-RAG) evaluate retrieval quality and trigger correction or abstention when retrieval is weak or unnecessary. Global and multi-hop queries selectively use GraphRAG/RAPTOR — never applied to every query, only when the router detects a global, multi-hop, or "catch me up" question.

## Embedding Interface

No single embedding model wins across all tasks and languages (MTEB). The memory layer should not marry one embedding "for everything"; it exposes an interface that can swap models or store multiple views of the same object. NV-Embed shows decoder LLMs can serve as strong generalist embedders, but the interface, not the model, is the durable decision.

## [Reference] Vector Backend Survey

Qdrant remains the authoritative Orquesta vector backend (see runtime invariants). This survey is reference-only and does not change that.

- **FAISS** — embedded, fast, configurable (IVF/PQ/HNSW/GPU); no built-in multi-tenancy/RBAC/consistency. Best as an internal high-performance engine.
- **Milvus** — distributed, consistency levels, multi-tenancy, RBAC/TLS, hybrid dense+sparse. Best as a multi-user operational plane.
- **Weaviate** — product-oriented, hybrid BM25+vector with configurable fusion, RBAC, per-tenant shards.

`[Hypothesis]` Any future backend change away from Qdrant requires a `DECISION-NNN` artifact.
