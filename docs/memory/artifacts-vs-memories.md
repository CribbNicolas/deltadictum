---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: stable
last_validated: 2026-04-26
sources:
  - .archive/planning/architecture.md (Memory Architecture)
  - .archive/planning/memory-task.md (artifacts vs memories)
depends_on: []
used_by:
  - memory/lifecycle-policies
  - memory/compression-strategy
do_not_co_load_with: []
---

# Artifacts vs Memories

## V2-V10 Boundary

Artifacts are evidence. Memories are behavioral units justified by evidence.

An artifact can be a spec, plan, test log, trace, tool output, diff, or decision record. A memory references artifacts through `evidence_refs` and states what future behavior should change.

Distinction between engineering artifacts and ephemeral retrievable memories.

## Core Principle

From `architecture.md`:

> Memory is NOT chat history.
> Memory is: persistent structured engineering cognition

From `memory-task.md`:

> You should separate artifacts from retrievable memories.
> Because NOT every artifact should go directly to retrieval.

## Artifacts

Artifacts are long-term, permanent knowledge outputs stored in the project's `artifacts/` directory.

### Characteristics

| Property | Value |
|----------|-------|
| Storage | Filesystem (`projects/<project>/artifacts/`) |
| Lifespan | Permanent (never auto-deleted) |
| Format | Raw documents, specs, plans, reviews |
| Retrieval | Direct file access, NOT semantic search |
| Compression | None — stored as-is |
| Examples | Full architecture spec, implementation plan, code review report |

### Artifact Categories

From `repository-structure.md`:

```
projects/<project>/artifacts/
├── specs/       # Specification documents
├── plans/       # Implementation plans
├── reviews/     # Code/spec review reports
└── decisions/   # Architecture decision records
```

### When to Create Artifacts

- Full specification documents
- Detailed implementation plans
- Comprehensive code reviews
- Architecture decision records (ADRs)
- Any document intended for human reading and reference

## Memories

Memories are compressed, structured cognitive representations stored in Qdrant for semantic retrieval.

### Characteristics

| Property | Value |
|----------|-------|
| Storage | Qdrant (vector) + PostgreSQL (metadata) |
| Lifespan | Temporary (subject to lifecycle policies) |
| Format | Structured JSON object with importance score |
| Retrieval | Semantic search within project namespace |
| Compression | Summarized and merged as needed |
| Examples | "Trade system moved to event-driven architecture" |

### Memory Categories

From `memory-object-format.md`:

| Type | Purpose |
|------|---------|
| architecture_decision | System design decisions and rationale |
| bug_fix | Bug diagnosis and resolution notes |
| implementation | Implementation details and patterns |
| review | Review findings and feedback |
| planning | Planning decisions and roadmaps |
| spec | Specification documents (compressed) |
| summary | Compressed summaries of longer content |
| decision | General decisions not fitting other types |

### When to Create Memories

- Key decisions that will be needed in future context
- Patterns discovered during implementation
- Bug fixes worth remembering for similar issues
- Architecture constraints that affect future work
- Any information that should be retrievable by semantic search

## The Separation Rule

From `memory-task.md`:

```
artifact: full architecture spec
memory: summary of architecture decision
```

### Rule: Artifacts → Memories

When an artifact is created, evaluate whether a memory should also be generated:

| Artifact | Memory Needed? | Reason |
|----------|---------------|--------|
| Full architecture spec | Yes | Key decisions worth semantic retrieval |
| Implementation plan | Maybe | Only if plan contains reusable patterns |
| Code review report | No | Review is ephemeral, findings go to memories if important |
| ADR (Architecture Decision Record) | Yes | Core decision is highly retrievable |
| Meeting notes | No | Too ephemeral, not engineering cognition |

### Rule: Memories → Artifacts

Memories should NEVER be stored as raw artifacts. If a memory needs full-text preservation:

1. Create the memory object (compressed, structured) for retrieval
2. Create the artifact document (full text) for reference
3. Link them via metadata (artifact reference in memory object)

## Summary

| Aspect | Artifacts | Memories |
|--------|-----------|----------|
| Purpose | Human reference | Machine retrieval |
| Storage | Filesystem | Qdrant + PostgreSQL |
| Format | Raw documents | Structured JSON |
| Lifespan | Permanent | Temporary (lifecycle-managed) |
| Retrieval | Direct access | Semantic search |
| Compression | None | Summarized/merged |
| Scope | Project-specific | Project-isolated namespace |
