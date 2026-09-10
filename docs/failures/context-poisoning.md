---
artifact_class: authored
owner_domain: failures
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on:
  - runtime/runtime-assumptions-v1
  - decisions/DECISION-003-shared-vs-project-cognition
used_by: []
do_not_co_load_with: []
---

# Context Poisoning

## Trigger Conditions
- Shared cognition contains outdated, incorrect, or conflicting rules/prompts
- Project-specific overrides are missing when they should exist, causing stale shared cognition to apply
- Retrieved memories contain incorrect conclusions or deprecated approaches
- Multiple sources provide contradictory instructions in the same context window

## Symptoms
- Agent produces code or decisions that contradict project standards
- Agent follows outdated patterns or deprecated architectures
- Inconsistent behavior across similar tasks (same prompt, different outcomes)
- Review agents flag systemic issues rather than task-specific problems

## Prevention
- Maintain clear ownership of cognition: project-specific overrides shared; shared cognition must be truly cross-project
- Version-control all cognition files; track changes via git history
- Apply memory importance scoring — low-importance memories are less likely to poison context
- Implement cognition review process for shared/ directory changes
- Keep prompts modular — isolated concerns prevent cross-contamination

## Recovery
- Identify the poisoned element in context (review retrieved memories and loaded cognition)
- Remove or correct the offending cognition/memory
- Retry inference with corrected context
- If shared cognition is the source, coordinate a fix across all affected projects
- Log the poisoning event for pattern analysis
