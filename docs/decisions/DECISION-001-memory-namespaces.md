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

A developer works across many repositories, each generating engineering knowledge over time. Without isolation, knowledge from one project contaminates retrieval in another: the same words mean different things in different codebases, so advice that crosses the boundary arrives confident and wrong.

Memory is structured engineering cognition — not chat history. It contains compressed cognitive representations: summaries of decisions, architecture notes, implementation lessons. Each project needs its own isolated memory space to prevent semantic contamination.

## Decision

Each project gets a dedicated knowledge namespace: the git-tracked `.dd/` directory of that repository, with every store query filtered by the project identifier resolved from the repository root. Cross-namespace retrieval requires an explicit decision artifact.

Write, retrieval, ranking and lifecycle all operate inside that boundary. There is no query path that omits the project filter.

## Consequences

- Retrieval engine must always include a project filter as the first step
- Knowledge is stored in the repository it describes, so a clone carries its own knowledge and nothing else
- The project identifier is derived from the repository, never supplied by the caller as a label that could be spoofed
- Cross-project cognition requires explicit decision artifacts and manual namespace mapping
- Growth is bounded per project, so one busy repository cannot crowd out another

## Tradeoffs

- **Sacrificed:** Easy cross-project memory search. Cross-project queries require explicit coordination.
- **Gained:** Complete isolation, no semantic contamination, predictable retrieval quality per project.

## Rejected Alternatives

1. **One shared store with project tags** — Rejected because a tag is a ranking signal, not a boundary: a filter that can be forgotten will be forgotten. Isolation has to be structural.
2. **A central store outside the repositories** — Rejected because it breaks the plugin shape. Knowledge that does not travel with the repository cannot be reviewed in a pull request, shared through git, or removed by removing the project.
