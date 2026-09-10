---
artifact_class: authored
owner_domain: contracts
artifact_type: behavioral-contract
stability: stable
last_validated: 2026-04-26
sources:
  - .archive/planning/memory-task.md
  - .archive/planning/architecture.md (Memory Architecture)
depends_on: []
used_by:
  - memory/memory-namespaces
  - memory/lifecycle-policies
  - services/memory-api
do_not_co_load_with: []
---

# Memory Contract

Behavioral contract for memory operations in the Orquesta system. Defines invariants, preconditions, and postconditions for all memory API operations.

## Invariants

These conditions must always hold for memory operations:

| # | Invariant | Description |
|---|-----------|-------------|
| M-INV-1 | Project isolation | Memories are always scoped to a project namespace |
| M-INV-2 | Structured format | All memories follow the Memory Object Format (`.docs/memory/memory-object-format.md`) |
| M-INV-3 | Importance required | Every memory must have an importance score (0.0–1.0) |
| M-INV-4 | No global search | Retrieval never searches all namespaces without project filter |
| M-INV-5 | Artifacts separate | Raw artifacts are NOT stored as memories |

## Memory Ingestion

### Preconditions

| # | precondition | Description |
|---|-------------|-------------|
| M-ING-1 | Valid object | Memory object conforms to the Memory Object Format schema |
| M-ING-2 | Project exists | Target project namespace exists in the project registry |
| M-ING-3 | Importance set | Importance score is provided (0.0–1.0) |

### Postconditions

| # | Postcondition | Description |
|---|---------------|-------------|
| M-ING-P1 | Vector stored | Embedding stored in Qdrant collection `memories_<project>` |
| M-ING-P2 | Metadata stored | Structured metadata stored in PostgreSQL |
| M-ING-P3 | Timestamps set | `created_at` and `last_used` timestamps are set |

## Memory Retrieval

### Preconditions

| # | precondition | Description |
|---|-------------|-------------|
| M-RET-1 | Project specified | Query includes project namespace filter |
| M-RET-2 | Query valid | Search query is non-empty and properly formatted |
| M-RET-3 | Namespace exists | Target Qdrant collection exists |

### Postconditions

| # | Postcondition | Description |
|---|---------------|-------------|
| M-RET-P1 | Results ranked | Results sorted by semantic similarity × importance |
| M-RET-P2 | last_used updated | `last_used` timestamp updated for all retrieved memories |
| M-RET-P3 | Budget respected | Total retrieved content fits within context budget |

### Retrieval Flow

```
project filter → memory type filter → semantic retrieval → importance ranking → context injection
```

## Memory Update

### Preconditions

| # | precondition | Description |
|---|-------------|-------------|
| M-UPD-1 | Memory exists | Memory ID exists in the target namespace |
| M-UPD-2 | Valid update | Update does not change project or type |
| M-UPD-3 | Authenticated | Requester has access to the target namespace |

### Postconditions

| # | Postcondition | Description |
|---|---------------|-------------|
| M-UPD-P1 | Vector updated | Embedding regenerated if content changed |
| M-UPD-P2 | Metadata updated | Structured metadata updated in PostgreSQL |
| M-UPD-P3 | Version tracked | Update is versioned (previous version preserved) |

## Memory Deletion

### Preconditions

| # | precondition | Description |
|---|-------------|-------------|
| M-Del-1 | Memory exists | Memory ID exists in the target namespace |
| M-Del-2 | Authorized | Requester has delete permission for the namespace |
| M-Del-3 | Not referenced | Memory is not referenced by other memories or artifacts |

### Postconditions

| # | Postcondition | Description |
|---|---------------|-------------|
| M-Del-P1 | Vector removed | Embedding removed from Qdrant |
| M-Del-P2 | Metadata removed | Structured metadata removed from PostgreSQL |
| M-Del-P3 | Audit logged | Deletion is logged with timestamp and requester |

## Memory Lifecycle Transitions

From `.docs/memory/lifecycle-policies.md`:

```
creation → scoring → retention → summarization → archival → deletion
```

Each transition has its own preconditions and postconditions defined in the lifecycle policy doc.

## Schema Reference

Memory objects follow the schema defined in `.docs/schemas/memory-schema.md`. This contract defines behavior; the schema defines structure.
