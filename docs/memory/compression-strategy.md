---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: stable
last_validated: 2026-04-26
sources:
  - .archive/planning/memory-task.md (Summarization, Compression)
  - .archive/planning/architecture-tasks.md (Task 5)
depends_on: []
used_by:
  - memory/artifacts-vs-memories
do_not_co_load_with: []
---

# Compression Strategy

## V2-V10 Evidence-Preserving Compression

Compression must not destroy the evidence needed to verify a durable memory. Future memory compression produces `micro`, `short`, and `full` retrieval forms while preserving `evidence_refs`, temporal validity, authority, and lifecycle state.

Lossy summaries are acceptable for observations and previews. Durable memories require enough retained structure to support verification, contradiction checks, and future supersession.

How memories are compressed and summarized to reduce context footprint.

## Purpose

From `memory-task.md`:

> Retrieval works on compressed cognitive representations, NOT on raw documents.

Compression reduces the context window footprint of stored memories while preserving essential information for future retrieval and injection.

## Compression Methods

### Summarization

From `memory-task.md`:

> Reduce long memories.

When memory content exceeds context budget thresholds:

| Content Size | Action |
|-------------|--------|
| < 500 chars | No compression needed |
| 500–2000 chars | Store as-is |
| 2000–5000 chars | Generate summary, store both full and summary |
| > 5000 chars | Compress to summary, archive full content separately |

Summarization preserves:
- Core decision or finding
- Key implementation details
- Relevant tags
- Importance score

### Merging

From `memory-task.md`:

> Fuse redundant memories.

When multiple memories contain overlapping information:

| Condition | Action |
|-----------|--------|
| Same project + same type + similar summary | Merge into composite memory |
| Same decision documented in multiple places | Consolidate into single authoritative memory |
| Related implementation notes | Group under parent memory with references |

Merge process:
1. Identify candidate memories (semantic similarity > 0.8)
2. Extract unique information from each
3. Create composite summary
4. Preserve all tags from source memories
5. Set importance = max(source importances)
6. Archive source memories (do not delete)

## Compression in Retrieval Pipeline

From `workflows/retrieval-injection-pipeline.md`:

When memories are retrieved for injection:

```
semantic search → importance rank → compress to fit budget → inject into context
```

1. Retrieve top-N memories by semantic similarity + importance
2. Sort by importance (descending)
3. Compress each memory to fit within remaining context budget
4. Inject compressed summaries into agent context
5. Full content available on-demand if agent requests it

## Budget Enforcement

The budget is the serialized retrieval result, not the host context window. DD does not know, and must
not assume, how large the host window is or what else occupies it.

- Default: 600 estimated tokens for the whole JSON result, metadata included.
- Accepted range: 128 to 8,000.
- Estimate: UTF-8 bytes divided by three, provider independent and deliberately approximate.
- Enforcement is greedy with form downgrade: a memory that does not fit as `full` is tried as
  `short`, then `micro`, and is skipped if even the smallest form does not earn its tokens.

The empty envelope is a fixed protocol cost. When nothing clears the bar, DD returns that envelope and
abstains; it never pads the result to look useful.

## Deriving Compact Forms

Compact forms are derived deterministically from the authored statement, with no model call
([plugin constraints](../architecture/plugin-constraints.md), L1 and L3). A compact form may drop
rationale and alternatives; it may never drop the scope, assumptions or revision conditions that make
the advice valid. Compression that removes the conditions does not produce a shorter memory, it
produces a wrong one.
