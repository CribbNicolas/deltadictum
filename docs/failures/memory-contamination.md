---
artifact_class: authored
owner_domain: failures
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on:
  - runtime/runtime-assumptions-v1
  - decisions/DECISION-001-memory-namespaces
used_by: []
do_not_co_load_with: []
---

# Memory Contamination

## Trigger Conditions
- Retrieval operates without a project filter as the first step (global retrieval)
- Namespace isolation is a filter applied late rather than a boundary applied first
- Cross-namespace retrieval occurs without explicit decision artifacts
- Memory objects lack proper `project` field, making them unscoped
- The project identifier is taken from the caller instead of resolved from the repository

## Symptoms
- Retrieved memories from unrelated projects appear in context
- Agent references architecture decisions from other projects
- Semantic confusion when similar terms have different meanings across projects
- Cross-project data leakage (project A sees project B's memory content)
- Retrieval quality degrades as irrelevant memories compete for injection slots

## Prevention
- Enforce INV-02: retrieval must always start with project filter
- Keep each project knowledge in the `.dd/` directory of its own repository
- Require explicit decision artifacts for any cross-namespace operation
- Validate memory objects have correct `project` field on ingestion
- Confine evidence references to the repository root, rejecting escapes at write time

## Recovery
- Immediately abort the contaminated retrieval and clear the context
- Identify which foreign memories were injected (check memory metadata)
- Remove contaminated memories from context; retry with strict project filter
- Audit the memory ingestion pipeline for missing project validation
- If systemic, rebuild the local index from the git-tracked files, which remain the authority
