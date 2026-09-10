---
artifact_class: authored
owner_domain: decisions
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on: []
used_by:
  - architecture/invariants
  - runtime/project-resolution
  - failures/context-poisoning
do_not_co_load_with: []
---

# DECISION-003 — Project Cognition Overrides Shared Cognition

Date: 2026-04-26
Status: Accepted

## Context

The system has two cognition layers: `shared/` (cross-project reusable knowledge) and `projects/<name>/` (project-specific knowledge). The v1 planning identified that project-specific needs often diverge from shared defaults, and the resolution order must be explicit.

The `project-resolver` component is described as "one of the most important components of the system" because it resolves: project context, inheritance, shared fallback, rules loading, skills loading, prompts loading, and memory namespace mapping.

## Decision

Project-specific cognition overrides shared cognition. The resolution order is:
1. Project-specific rules/prompts/skills (highest priority)
2. Shared rules/prompts/skills (fallback)

Shared cognition exists as fallback only. When a project defines its own version of a rule, prompt, or skill, it completely replaces the shared version for that project.

## Consequences

- `project-resolver` implements inheritance chain: project -> shared -> default
- Each project directory contains its own `rules/`, `prompts/`, `skills/`, `configs/`
- Shared directories (`shared/rules/`, `shared/prompts/`, `shared/skills/`) contain only truly cross-project knowledge
- Project configs override shared configs (e.g., `projects/tme/configs/retrieval.json` overrides `shared/configs/retrieval.json`)
- Agent definitions are project-specific; shared agents are not a pattern

## Tradeoffs

- **Sacrificed:** Centralized updates propagate automatically. Shared changes require explicit project-level adoption.
- **Gained:** Project autonomy, no forced shared behavior, clean override semantics.

## Rejected Alternatives

1. **Shared cognition overrides project cognition** — Rejected because it prevents project specialization and forces uniformity where diversity is needed.
2. **Merge-based resolution (shared + project merged)** — Rejected because merge semantics are complex (field-level merge? array concat? last-wins?). Simple override is clearer and easier to reason about.
