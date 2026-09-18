---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-09-18
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

`decideAdmission` in `src/engine/v2/admission.js` decides admissibility structurally and reports source
reliability. It checks that required fields are present and that the payload is safe, and it derives the
reliability ceiling the memory's source earns. It still makes no judgement about value or novelty.

Required and non-empty: `project_id`, `memory_type`, `scope`, `title`, `trigger`, `behavior_delta`,
`what`, `why`, `topic_key`, at least one well-formed `evidence_refs` entry (`source_type`,
`source_ref`, `summary`), and both the `micro` and `short` compact forms.

Two checks go beyond presence:

- An `anti_memory` whose `behavior_delta` does not actually prevent anything is blocked. The check is a
  preventive-language match in English and Spanish.
- Content carrying prompt-injection markers or unsanitised model output is blocked.

## Source reliability

`src/engine/reliability.js` declares one ordinal ladder, least to most reliable, mirroring the shape of
`src/engine/authority.js`: an ordered list with derived projections, so a second table cannot drift from
it. Each level is a **ceiling on attainable confidence**, never a value to assign.

| Source | Assigned when | Cap |
|---|---|---|
| `agent_claim` | nothing verified — including a `user_statement` or `user_approval` reference | 0.5 |
| `host` | a `tool_output` reference resolving to a recorded host observation | 0.7 |
| `filesystem` | a `file`, `diff` or `test_log` reference resolved inside the repository and hashed | 0.85 |
| `user_correction` | an observed explicit user correction | 0.95 |

The level is the most reliable **verified** artifact the memory carries. An unverified reference is an
agent claim whatever source type it names, so a memory with no verified evidence sits on the bottom rung
however it was captured. Volume does not lift a memory past its ceiling either: three verified files
reach the same cap as one.

`capture_origin` is read as a factor at or below 1, never as a level of its own:
`user_explicit` × 1, `model_initiated` × 0.9, and an unrecognised origin takes the lowest factor. It can
only lower a ceiling. An agent-reported claim that the user asked for a save is not authenticated human
approval — a factor scales every rung equally, so it can never lift an unverified claim above a verified
artifact. Which observation provenances count as verified is derived from the ladder itself
(`VERIFIED_OBSERVATION_PROVENANCES`), read by `verifyReferences`.

The ladder never blocks. An unverified proposal is still admissible as a candidate awaiting review; what
provenance decides is the ceiling, and the ceiling is applied **at admission**, not at proposal.
Candidates are never retrieved — `retrieveMemories` filters to `active` and `contested` — so a
proposal-time confidence affects no ranking. The number that the retrieval value at
`src/engine/retrieve.js:46` reads is stamped by `admitMemory`, from the evidence it verifies during
review. A proposal therefore always lands on the unverified rung, because nothing has been verified when
`normalizeProposal` runs.

**Human review sits above the ladder.** A reviewer granting `canonical` sets confidence to 1 and is not
clamped: the ladder bounds what a source reaches without review, not what a human decides. A reviewer
granting `validated` accepts the ceiling.

**Knowledge written before the ladder keeps its stored confidence** until something re-derives it.
`reverifyStoredEvidence` (`src/engine/reverify.js`, run by `node scripts/reverify-evidence.mjs`) re-reads
the references a stored memory already carries and re-derives `evidence_state` and `confidence` from
what they resolve to now. It is not a review and does not behave like one: authority, lifecycle state and
the review stamp never move, so nothing is promoted and a `canonical` grant stays where the reviewer put
it. It is read-only unless given `--apply`, because it rewrites git-tracked knowledge, and it refuses a
reference that escapes the repository exactly as admission does.

**Nothing else raises it.** A reported outcome is telemetry (`src/engine/feedback.js:12-13`), a
resolution win is a track record, and re-proposing the same knowledge is ignored. No quantity of agent
claims reaches the standing of one verified artifact; `tests/engine/reliability.test.js` asserts that
under volume.

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
| `update` | The trigger collides with one effective memory of the same scope, saying the same thing | Stored as a **candidate** that names the colliding memory in `replaces`. Approval supersedes it; nothing changes before review. |

Two further decisions belong to the lifecycle layer rather than the gate: `admit`, when local human
review promotes a candidate, and `contest`, when a caller declares a contradiction.

`warn` was removed from the list. It would have been a middle ground between advising and blocking,
and there is no such ground while every write already stops at a candidate awaiting review.

Note that `ADMISSION_DECISIONS` is itself a declaration with no consumer: nothing imports it, and the
decisions the gate returns are string literals. The vocabulary that is actually enforced lives in the
SQL `CHECK` constraints.

## Equivalence and collision

Deduplication is **exact**: two proposals are equivalent when thirteen authored fields serialise
identically and their evidence signatures match. A paraphrase is therefore a new candidate, not a
duplicate.

The write path also computes `collides_with` **before the atom is written**: effective memories whose
trigger overlaps the proposal by at least `config.health.trigger_collision.jaccard` (0.5 by default,
the same threshold the health indicator uses). It is returned to the caller and it routes the decision.

Routing is in `routeTriggerCollision` (`src/engine/v2/admission.js`). Peers on the proposal's own
`topic_key` are excluded — that is supersession, already handled by `replaces`. Candidates join the
comparison but are never a revision target: a candidate is not effective, so superseding it would mean
nothing.

| Collision | Decision |
|---|---|
| None above the threshold | `write` — a candidate, as before |
| Exactly one effective peer, same scope, same direction | `update` — a candidate revising that peer |
| Any declared scope dimension disjoint | `write` — distinct knowledge, not a duplicate |
| Anything else that collides | `write`, with `suspected_duplicate_pair` and the peer ids in `suspected_pair` |

Two guards decide which of those applies, and both are lexical because a hook can afford nothing else:

- **Scope.** `compareScope` compares `applies_to.files`, `.components`, `.operations` and the keyed
  `assumptions`. Disjoint on any declared dimension means *different knowledge* — the same conclusion
  the activation gate reaches in `src/engine/activation.js`. One side declaring what the other leaves
  open is *ambiguous*, and ambiguity escalates to the reviewer rather than resolving itself.
- **Direction.** `agreesInDirection` requires the same `memory_type` and the same polarity under the
  preventive vocabulary the anti-memory gate already uses. Two memories that share a trigger and a
  scope while telling the agent opposite things are a contradiction, resolved through
  `declareContradiction` and review — never by superseding one with the other.

Nothing here changes an effective memory. An `update` is a candidate; approval is what applies it, and
`admitMemory` re-checks that the named replacement is still effective before doing so.

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
status, scope and authority. Source reliability is now read — see *Source reliability* above — as a
declared ordinal ladder rather than an estimated score, for the same reason: L6 leaves nothing to
estimate one from.

## Update, do not append

The intent: when an equivalent memory exists, strengthen, revise, contest or supersede it rather than
accumulate a second durable copy.

What happens today: a same-key proposal sets `replaces`, and the swap takes effect only when a human
approves it, so the effective memory never changes without review. An exactly equivalent proposal is
ignored. A paraphrase on a different key is routed as an `update` when its scope and direction match
the memory it collides with, and it is flagged as a suspected pair when they only partly match — see
*Equivalence and collision* above.

What still becomes a separate candidate: a proposal that merely adds a condition, and any collision
whose scope is ambiguous. Both go to the reviewer with the pair named, because merging two memories
that only resembled each other is the expensive error and a duplicate is recoverable where deleted
knowledge is not.

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
