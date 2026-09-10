---
artifact_class: authored
owner_domain: architecture
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on:
  - runtime/runtime-assumptions-v1.md
used_by:
  - runtime/project-resolution
  - runtime/retrieval-injection
  - failures/memory-contamination
  - failures/parallel-inference-collision
  - decisions/DECISION-001-memory-namespaces
  - decisions/DECISION-002-single-inference-runtime
do_not_co_load_with: []
---

# Invariants

Architectural invariants — properties that must remain true at all times. These are non-negotiable constraints derived from the v1 planning artifacts. Violating an invariant is a system-level failure.

## INV-01: Project Isolation Mandatory

Every project must have isolated memory scope, isolated retrieval rules, isolated agent permissions, and isolated vector collections. Projects must NOT share memory state directly. Cross-project cognition requires explicit decision artifacts.

**Source:** `architecture.md` "Project Isolation" section; `repository-structure.md` "Project Layer"; `memory-task.md` namespace isolation.

## INV-02: Namespace Isolation

Memory namespaces isolate projects (`memories_tme`, `memories_automation`, `memories_infra`). Cross-namespace retrieval requires explicit decision. Namespace boundaries prevent semantic contamination between project memory spaces.

**Source:** `architecture.md` recommended Qdrant collections; `memory-task.md` namespace isolation recommendation.

## INV-03: Single Inference

The local reasoning model serves a single active inference at a time. Parallel inference collisions are forbidden by design. The llama.cpp service runs with `--parallel 1`. An inference queue protection layer enforces 1 active inference max with automatic queueing.

**Source:** `architecture.md` "single-task execution only"; `ia-task.md` "single execution only", "parallel inference collisions".

## INV-04: Memory Is Not Chat History

Memory is structured engineering cognition — persistent, structured, and purpose-built for long-term learning. It is not a log of conversations. Memory contains compressed cognitive representations (summaries of decisions, architecture notes), not raw conversation transcripts.

**Source:** `architecture.md` "Memory is NOT chat history"; `memory-task.md` "compressed cognitive representations".

## INV-05: Embedding Separation

Embedding workloads run on a dedicated service separate from the reasoning model. Embedding requests must never block reasoning inference. A blocked reasoning model destroys throughput. The embedding service uses significantly lighter resources (8192 context, 2048 batch size, 8 threads) compared to the reasoning model (65536 context, 4096 batch size, 24 threads).

**Source:** `architecture.md` embedding section; `ia-task.md` "embedding model separated is VERY important", "your 35B stays blocked doing embeddings".

## INV-06: Retrieval Is Project-Scoped First

Retrieval must NEVER search globally first. The retrieval flow is strictly ordered: project filter -> memory type filter -> semantic retrieval -> importance ranking -> context injection. Global retrieval (no project filter) is forbidden.

**Source:** `architecture.md` "Retrieval should NEVER search globally first"; retrieval flow specification.

## INV-07: Modular Compose

The Docker Compose stack is intentionally split into multiple compose files (`core.yml`, `memory.yml`, `ai.yml`, `orchestration.yml`, `queue.yml`, `observability.yml`). Benefits include easier maintenance, optional subsystems, cleaner debugging, modular scaling, and reusable infrastructure blocks. A `compose.override.yml` handles machine-specific overrides without breaking the portable base architecture.

**Source:** `architecture.md` "Docker Compose Strategy"; `compose-task.md` modular compose with profiles.

## INV-08: Separation of Concerns

The infrastructure separates: reasoning, embeddings, orchestration, memory, agents, rules, artifacts, and observability. Each concern has a distinct responsibility boundary. This separation prevents memory contamination, reasoning bottlenecks, agent drift, infrastructure coupling, and prompt chaos.

**Source:** `architecture.md` "Core Architecture Philosophy" separation table; `orchestration-task.md` cognition vs working code separation.

## Authority Resolution Order

When multiple artifacts define overlapping constraints, resolve authority in this order:

1. **Invariants** (this file) — non-negotiable, must never be violated
2. **Anti-goals** (`.docs/architecture/anti-goals.md`) — forbidden trajectories
3. **Decisions** (`.docs/decisions/`) — accepted architectural choices
4. **Runtime assumptions** (`.docs/runtime/`) — design assumptions subject to revision
5. **Glossary** (`.docs/glossary/`) — terminology definitions

Conflicts between invariants and lower-authority artifacts are resolved in favor of the invariant.
