---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: stable
last_validated: 2026-05-14
sources:
  - .archive/planning/memory-task.md (Lifecycle)
  - .archive/planning/architecture-tasks.md (Task 5)
  - .docs/specs/2026-05-14-memory-lifecycle-retrieval-design.md
depends_on:
  - .docs/specs/2026-05-14-memory-lifecycle-retrieval-design.md
used_by:
  - memory/compression-strategy
  - memory/artifacts-vs-memories
do_not_co_load_with: []
---

# Lifecycle Policies

## V2 Behavioral Lifecycle States

The V2-V10 lifecycle extends the V1 creation/scoring/retention/summarization/archival/deletion flow with behavioral states:

| State | Meaning |
|---|---|
| `observation` | Sanitized event or evidence that is not durable memory yet. |
| `candidate` | Proposed durable memory pending admission or validation. |
| `active` | Durable memory available for retrieval and behavior influence. |
| `contested` | Memory conflicts with another memory and must not silently override it. |
| `superseded` | Memory remains auditable but is no longer the current guidance. |
| `archived` | Memory is preserved outside active retrieval. |
| `rejected` | Candidate was denied durable status. |

Memory lifecycle stages from creation through deletion.

## Lifecycle Stages

From `memory-task.md`:

```
creation → scoring → retention → summarization → archival → deletion
```

### Stage 1: Creation

Memories are created when:
- Architecture decisions are made
- Bug fixes are implemented
- Implementation patterns are established
- Reviews produce actionable findings
- Planning documents are finalized

Creation triggers:
- Explicit memory ingestion via memory-api
- Automatic capture from agent execution traces
- Summarization of completed tasks

### Stage 2: Scoring

Immediately after creation, memories are scored for importance.

From `importance-scoring.md`:

| Factor | Weight |
|--------|--------|
| Recency | 25% |
| Frequency of use | 25% |
| User feedback | 30% |
| Task relevance | 20% |

Score range: 0.0–1.0. Initial score based on type relevance and recency (frequency and feedback start at baseline).

### Stage 3: Retention

Memories are actively retained and available for retrieval while importance >= 0.2.

Retention behaviors:
- Memories with importance >= 0.7: high-priority retrieval candidate (subject to semantic gating and context budget)
- Memories with importance 0.4–0.7: included when semantically relevant
- Memories with importance 0.2–0.4: included only when project namespace has insufficient results
- Memories with importance < 0.2: flagged for archival consideration

Decay rate: tiered -0.005/day normal (see importance-scoring.md for tiered protection).

See `.docs/specs/2026-05-14-memory-lifecycle-retrieval-design.md` for full retention specification.

### Stage 4: Summarization

From `memory-task.md`:

> Reduce long memories.

When a memory's content exceeds the context budget or when summarization is triggered:

| Condition | Action |
|-----------|--------|
| Content > 2000 chars | Compress to summary, store full in archival storage |
| Age > 90 days + importance < 0.5 | Summarize to single paragraph |
| Multiple related memories | Merge into composite summary |

Summarization preserves:
- Core decision/finding
- Key implementation details
- Tags and metadata

Summarization does NOT preserve:
- Verbatim conversation logs
- Raw code snippets (stored separately as artifacts)
- Debug trace output

### Stage 5: Archival

Memories move to archival storage when:
- Importance < 0.2 for 60+ consecutive days
- Age > 365 days regardless of importance
- Explicit archival request via memory-api

Archival behavior:
- Memory object preserved in PostgreSQL (structured metadata)
- Vector embedding removed from Qdrant (no longer searchable)
- Full content stored in compressed archival storage
- Archival entries accessible via admin API (not retrieval pipeline)

### Stage 6: Deletion

Memories are permanently deleted when:
- Age > 730 days (2 years) in archival
- Explicit deletion request via memory-api
- Storage quota exceeded (lowest-importance archived memories deleted first)

Deletion is irreversible. Archival entries are logged before deletion for audit trail.

## Lifecycle Service

From `memory-task.md` suggested structure:

```
memory-api/
└── services/
    └── lifecycle.service.js
```

Responsibilities:
- Evaluate memories against lifecycle thresholds
- Trigger summarization when content exceeds budget
- Move memories between retention → archival → deletion states
- Apply importance decay on schedule
- Enforce storage quotas

## Configuration

Per-project lifecycle tuning via:

```
projects/<project>/memory/lifecycle.json
```

Overrides:
- Custom importance thresholds
- Project-specific decay rates (including tier multipliers)
- Retention period adjustments
- Summarization triggers
- Decay tier configuration (ultra_slow, slow, normal multipliers)
