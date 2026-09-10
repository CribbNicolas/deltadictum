---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: stable
last_validated: 2026-04-26
sources:
  - .archive/planning/architecture.md (Project Isolation, Memory Architecture)
  - .archive/planning/memory-task.md (namespace isolation)
  - .docs/decisions/DECISION-001-memory-namespaces.md
depends_on:
  - decisions/DECISION-001-memory-namespaces
used_by:
  - memory/memory-object-format
  - memory/lifecycle-policies
  - workflows/retrieval-injection-pipeline
do_not_co_load_with: []
---

# Memory Namespaces

## V2-V10 Scope Extension

Namespace isolation remains mandatory. V2-V10 add scope inside the project namespace: `project`, `user`, `agent`, `workflow`, `file`, and `service`.

Scope never permits cross-project retrieval by default. Project filter remains the first retrieval and write boundary.

Project-isolated memory namespaces for Qdrant collections and retrieval scoping.

## Project Isolation Requirement

From `architecture.md`:

> Every project must have:
> - isolated memory scope
> - isolated retrieval rules
> - isolated agent permissions
> - isolated vector collections

This prevents semantic contamination between projects — memories from one project must not leak into another project's retrieval context.

## Recommended Qdrant Collections

From `architecture.md` and `memory-task.md`:

| Collection | Project | Purpose |
|-----------|---------|---------|
| `memories_tme` | tme | Trade management engine project memories |
| `memories_automation` | automation | Automation project memories |
| `memories_infra` | infra | Infrastructure project memories |

Pattern: `memories_<project>`

Each collection is a fully isolated Qdrant collection with its own vectors, payloads, and indexing.

## Cross-Namespace Retrieval Rules

From `architecture.md` — Retrieval Strategy:

> Retrieval should NEVER search globally first.

### Retrieval Flow

```
project filter
    ↓
memory type filter
    ↓
semantic retrieval (within project namespace only)
    ↓
importance ranking
    ↓
context injection
```

### Rules

1. **Primary scope**: Always query the project-specific namespace first (`memories_<active_project>`)
2. **Fallback**: Only if project namespace returns insufficient results, query shared namespace
3. **Never**: Search all collections globally without project filter
4. **Always**: Apply memory type filter before semantic search
5. **Always**: Rank by importance before context injection

### Shared Cognition Fallback

From `.docs/decisions/DECISION-003-shared-vs-project-cognition.md`:

- Shared cognition lives in a separate namespace (no project prefix)
- Shared memories are queried only as fallback when project-specific retrieval is insufficient
- Shared memories have lower importance scores by default
- Shared memories cannot override project-specific memories

## Namespace Service

From `memory-task.md` suggested structure:

```
memory-api/
└── services/
    └── namespace.service.js
```

Responsibilities:
- Resolve project → collection name mapping
- Validate namespace access permissions
- Manage collection lifecycle (create, delete, snapshot)
- Handle cross-namespace retrieval routing

## Project Registry Mapping

From `orchestration-task.md`:

```json
{
  "tme": {
    "workspace": "/workspace/tme",
    "memory_namespace": "memories_tme",
    "default_agent": "architect"
  }
}
```

The project registry maps project identifiers to their memory namespaces, enabling dynamic namespace resolution at runtime.
