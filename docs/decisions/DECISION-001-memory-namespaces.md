---
artifact_class: authored
owner_domain: decisions
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on: []
used_by:
  - architecture/invariants
  - runtime/retrieval-injection
  - failures/memory-contamination
do_not_co_load_with: []
---

# DECISION-001 — Memory Namespaces Isolate Projects

Date: 2026-04-26
Status: Accepted

## Context

The system manages multiple projects (tme, automation, infra) that each generate engineering cognition over time. Without isolation, memory from one project would contaminate retrieval for another. The v1 planning identified namespace isolation as critical infrastructure.

Memory is structured engineering cognition — not chat history. It contains compressed cognitive representations: summaries of decisions, architecture notes, implementation lessons. Each project needs its own isolated memory space to prevent semantic contamination.

## Decision

Each project gets a dedicated memory namespace (Qdrant collection): `memories_tme`, `memories_automation`, `memories_infra`. Cross-namespace retrieval requires an explicit decision artifact. The `project-resolver` component maps each project to its memory namespace at runtime.

Memory ingestion, retrieval, ranking, summarization, compression, and lifecycle management all operate within the project's namespace boundary.

## Consequences

- Retrieval engine must always include a project filter as the first step
- Memory API services (memory-api, memory-worker) receive `ACTIVE_PROJECT` environment variable
- Qdrant collections are created per-project, not globally
- Cross-project cognition requires explicit decision artifacts and manual namespace mapping
- Memory importance scoring prevents explosion within each namespace independently

## Tradeoffs

- **Sacrificed:** Easy cross-project memory search. Cross-project queries require explicit coordination.
- **Gained:** Complete isolation, no semantic contamination, predictable retrieval quality per project.

## Rejected Alternatives

1. **Single shared memory with project tags** — Rejected because tags don't prevent semantic contamination at the vector level. Different projects may use similar terms with different meanings.
2. **Project-scoped Qdrant instances** — Rejected because it multiplies infrastructure cost and complexity. Namespace isolation within a single Qdrant instance provides equivalent isolation at lower cost.
