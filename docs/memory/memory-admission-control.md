---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-05-30
depends_on:
  - memory/behavioral-memory-architecture.md
used_by:
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
do_not_co_load_with: []
---

# Memory Admission Control

Summary: Policy for deciding when observed experience becomes durable memory.

## Admission Decision

Every write attempt passes through an admission decision:

```text
event -> write | update | observe | ignore | warn | block | contest
```

## Decision Meanings

| Decision | Meaning |
|---|---|
| `write` | Create a new durable memory. |
| `update` | Strengthen, revise, or supersede an existing memory. |
| `observe` | Store as observation only because evidence or utility is insufficient. |
| `ignore` | Do not store because future utility is too low. |
| `warn` | Return warning because write is risky but not forbidden. |
| `block` | Reject write because it violates schema, policy, scope, or safety. |
| `contest` | Preserve conflict as contested rather than overwriting higher-authority memory. |

## Admission Score

Admission is based on operational value, not salience alone:

```text
memory_admission_score =
  future_reuse_probability
  * behavioral_impact
  * evidence_strength
  * recurrence_risk
  * correction_value
  * authority_gain
  - storage_cost
  - retrieval_noise_risk
  - privacy_risk
  - contradiction_risk
```

## V2 Minimum Gate

For V2, durable writes require non-empty `trigger`, `behavior_delta`, and `evidence_refs`. If any is missing, the event can only become an `observation`, `ignore`, `warn`, or `block` decision.

## Update, Do Not Append

If `topic_key` or semantic dedupe finds an equivalent memory, the system updates, reinforces, contests, or supersedes the existing memory instead of creating duplicate durable memory.

## Decision Table

Admission combines the score with deterministic rules:

| Case | Action |
|---|---|
| High utility + strong evidence | Write as active durable memory |
| High utility + weak evidence | Write as candidate / observation |
| Repeatable error | Create anti-memory |
| New architecture rule | Create decision/claim (canonicalizable) |
| Information already present | Merge / update, do not duplicate |
| Ephemeral datum | Do not store, or store with TTL |
| Contradicts high-authority memory | Mark contested, do not overwrite |
| Useful only for debugging | Observation, not durable memory |

## Reuse Contracts

Every durable memory carries an implicit reuse contract:

```text
This memory exists to improve [task type]
when [trigger] appears,
provided [conditions hold],
and must be revised or discarded when [invalidation condition].
```

The contract makes memory operational rather than documentary. `trigger`, `behavior_delta`, and `valid_until` (or an invalidation note) express it. A durable memory that cannot state its invalidation condition is a candidate, not active.
