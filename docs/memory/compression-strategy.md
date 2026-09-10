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
  - memory/lifecycle-policies
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

### Token Budget Enforcement

From `.docs/decisions/DECISION-006-65k-context-budget.md`:

Total context budget: 65,536 tokens. Memory injection must fit within this budget alongside:
- System prompt
- Project cognition
- Task description
- Retrieved memories (compressed)
- Agent instructions

Memory injection budget allocation:
- System/project cognition: ~10,000 tokens
- Task description: ~2,000 tokens
- Retrieved memories: ~40,000 tokens (max)
- Agent instructions: ~5,000 tokens
- Safety margin: ~8,536 tokens

## Compression Service

From `memory-task.md` suggested structure:

```
memory-api/
├── memory/
│   ├── summarization/
│   │   └── summarize.js
│   └── compression/
│       └── compress.js
```

Summarization service:
- Generates concise summaries of long memories
- Uses LLM-based summarization (llama-cpp or Claude)
- Preserves structured metadata
- Stores both full and summarized versions

Compression service:
- Merges redundant memories
- Applies token budget constraints
- Manages archival of full content
- Maintains reference links between merged memories

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
