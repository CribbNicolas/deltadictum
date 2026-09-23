---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: stable
last_validated: 2026-09-17
depends_on:
  - architecture/plugin-constraints.md
  - architecture/invariants.md
do_not_co_load_with: []
---

# Memory Namespaces

Summary: knowledge is scoped to a project, and the project filter is the first boundary on every read
and every write.

> The earlier version of this file described per-project Qdrant collections (`memories_<project>`) and
> a namespace service that resolved them. DD is a harness plugin with no vector store and no service;
> the mechanism below is what actually enforces isolation. See
> [plugin constraints](../architecture/plugin-constraints.md).

## Why isolation comes first

Different projects use the same words for different things. A retry policy that is correct in one
repository is wrong in another, and advice that crosses that boundary is worse than no advice: it is
confident and wrong. Isolation is therefore structural, not a ranking preference.

## How a namespace is realised

A namespace is a project identifier plus the `.dd` directory of that repository:

- Knowledge lives in git-tracked files under the project's own `.dd/` directory, so a repository
  carries its knowledge with it and a clone carries nothing else.
- Every store query is filtered by `project_id`; there is no query path that omits it.
- The project identifier is resolved from the repository root, not supplied by the caller as a label
  that could be spoofed.
- Evidence references are confined to that repository: a path that escapes the root is rejected at
  write time, not at read time.

## Retrieval flow

```text
project filter
  -> lifecycle and memory-type filter
  -> candidate generation (local full-text index)
  -> applicability gate (scope, assumptions, validity window)
  -> ranking (activation, reliability, usage)
  -> budgeted injection
```

There is no global search, and no fallback that widens the scope when a project returns too little.
Returning nothing is a correct answer.

## Cross-project knowledge

There is none. Knowledge from another project is never an automatic fallback.

## Failure this prevents

Memory contamination: knowledge from one project applied in another. It is not primarily a privacy
problem; it is a correctness problem, and secondarily a retrieval-quality one — irrelevant knowledge
competing for a small number of injection slots.
