---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-09-17
depends_on:
  - memory/behavioral-memory-architecture.md
  - architecture/plugin-constraints.md
used_by:
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
do_not_co_load_with: []
---

# Memory Admission Control

> Scope: DD is a harness plugin. Everything here operates inside
> [the plugin constraints](../architecture/plugin-constraints.md).

Summary: policy for deciding when observed experience becomes durable memory.

Sections marked **Not implemented** describe intent the code does not carry. They are named here rather
than deleted because the gap is the point; see [the roadmap](roadmap.md).

## What the gate actually does

`decideAdmission` in `src/engine/v2/admission.js` is **purely structural**. It checks that required
fields are present and that the payload is safe. It makes no judgement about value, novelty or source
reliability.

Required and non-empty: `project_id`, `memory_type`, `scope`, `title`, `trigger`, `behavior_delta`,
`what`, `why`, `topic_key`, at least one well-formed `evidence_refs` entry (`source_type`,
`source_ref`, `summary`), and both the `micro` and `short` compact forms.

Two checks go beyond presence:

- An `anti_memory` whose `behavior_delta` does not actually prevent anything is blocked. The check is a
  preventive-language match in English and Spanish.
- Content carrying prompt-injection markers or unsanitised model output is blocked.

## Decisions the code emits

```text
proposal -> block | observe | write | ignore
```

| Decision | When | Result |
|---|---|---|
| `block` | Missing identity or type, invalid scope, unsafe content, or a non-preventive anti-memory | Nothing is stored; the reasons are logged. |
| `observe` | Any other contract failure | Stored as an observation, never as knowledge. |
| `write` | Contract satisfied | Stored as a **candidate**, awaiting human review. Never active. |
| `ignore` | An equivalent memory already exists | The existing memory is returned unchanged. |

Two further decisions belong to the lifecycle layer rather than the gate: `admit`, when local human
review promotes a candidate, and `contest`, when a caller declares a contradiction.

**Not implemented.** `ADMISSION_DECISIONS` in `src/engine/v2/constants.js` also declares `update`,
which is never emitted. It is the missing collision routing — see *Update, do not append* below — and
is kept for that.

`warn` was removed from the list. It would have been a middle ground between advising and blocking,
and there is no such ground while every write already stops at a candidate awaiting review.

Note that `ADMISSION_DECISIONS` is itself a declaration with no consumer: nothing imports it, and the
decisions the gate returns are string literals. The vocabulary that is actually enforced lives in the
SQL `CHECK` constraints.

## Equivalence and collision

Deduplication is **exact**: two proposals are equivalent when thirteen authored fields serialise
identically and their evidence signatures match. A paraphrase is therefore a new candidate, not a
duplicate.

The write path also computes `collides_with`: effective memories whose trigger overlaps the proposal
by a Jaccard score of 0.5 or more. It is returned to the caller.

**Not implemented.** Nothing acts on `collides_with`. It is reported and then ignored — no block, no
merge, no contest. Acting on it is a Phase 1 item.

## Admission score

**Not implemented.** Earlier versions of this document specified a utility score:

```text
memory_admission_score =
  future_reuse_probability * behavioral_impact * evidence_strength
  * recurrence_risk * correction_value * authority_gain
  - storage_cost - retrieval_noise_risk - privacy_risk - contradiction_risk
```

No such computation exists. `decideAdmission` returns a constant label — `0`, `0.25` or `1` — that
nothing consumes. The formula is kept as a statement of what the gate lacks, not as a description of
it.

Most of its factors are also unmeasurable at write time in a plugin: reuse probability and recurrence
risk need volume DD will never have (L6), and storage cost is negligible when knowledge is a
git-tracked JSON file. What *is* available on the first observation is source reliability, evidence
status, scope and authority. That is the direction Phase 1 takes instead.

## Update, do not append

The intent: when an equivalent memory exists, strengthen, revise, contest or supersede it rather than
accumulate a second durable copy.

What happens today: a same-key proposal sets `replaces`, and the swap takes effect only when a human
approves it, so the effective memory never changes without review. An exactly equivalent proposal is
ignored. Everything between those two — a paraphrase, a near-duplicate on a different key, a proposal
that merely adds a condition — becomes a separate candidate.

## Reuse contract

Every durable memory carries an implicit contract:

```text
This memory exists to improve [task type]
when [trigger] appears,
provided [conditions hold],
and must be revised or discarded when [invalidation condition].
```

This is what makes memory operational rather than documentary. `trigger`, `behavior_delta`,
`assumptions`, `revisit_when` and `valid_until` express it.

The gate does not enforce the last clause: a memory that states no invalidation condition is still
admissible. What enforces it in practice is review, plus the freshness recheck that turns changed file
evidence into a review notice at recall time.
