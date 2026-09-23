---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-05-30
depends_on:
  - memory/memory-admission-control.md
used_by:
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Evidence Ledger

> Scope: DD is a harness plugin. Everything here operates inside
> [the plugin constraints](../architecture/plugin-constraints.md).

Summary: Durable memory is claim plus evidence plus temporal validity.

## Claim-Evidence Rule

Every durable memory must be evidence-bearing by construction. A durable memory without evidence is downgraded to observation or rejected.

## Evidence Capsule

Evidence can reference test logs, tool outputs, files, diffs, traces, decisions, user approvals, or artifacts.

```json
{
  "evidence_id": "uuid",
  "source_type": "test_log|tool_output|file|diff|trace|decision|user_approval|artifact",
  "source_ref": "stable reference",
  "observed_at": "timestamp",
  "hash": "sha256-or-null",
  "summary": "what this evidence supports",
  "sensitivity": "public|project|private|secret"
}
```

## Temporal Validity

Memory tracks when a claim is valid.

- `valid_from`: when the claim became true or actionable. Defaults to write time.
- `valid_until`: when the claim stops being true or useful. Optional; an expired window suppresses the
  advice rather than flagging it.

`observed_at` exists on **observations**, not on knowledge. An atom therefore carries valid time only.

## Coverage as a Ranking Signal

The count of references whose bytes were verified is the primary tier of the contested-resolution
order (see `contradiction-supersession.md`). It is derived from `evidence_state.verified_count` at
comparison time rather than stored, so it cannot drift from the evidence it summarises.

It measures integrity, never entailment. That is precisely why authority and human review occupy
separate tiers: coverage says the artifacts are real, and review says the claim follows from them.

## Relations

The relation table permits six types: `supports`, `contradicts`, `supersedes`, `derived_from`,
`blocks` and `related_to`. Supersession also records `superseded_by` directly on the atom.

**Not implemented.** Only `supersedes` and `contradicts` are ever written, so the relation graph
carries succession and dispute and nothing else. The other four are not equal in status:

- `supports`, `blocks` and `derived_from` are **reserved with a plan** — argumentation semantics and
  the anti-memory veto path, both roadmap phase 3.
- `related_to` has **no producer and none planned.** It survives only because removing a value from a
  SQL `CHECK` would apply to new databases and not to existing ones: `migrate()` runs
  `CREATE TABLE IF NOT EXISTS`, and the index rebuild repopulates rows without recreating tables.
  Enforcing a constraint on some installs and not others is worse than leaving an unused value. Earlier versions of this document named
`supported_by`, `refuted_by`, `caused_by` and `effective_during`; none of those exist under any name.

## Bitemporal Detail

**Not implemented.** The intent is two independent time axes on durable knowledge:

- **Transaction time** — when the system came to believe the claim.
- **Valid time** — `valid_from` / `valid_until`: when the claim is actually true in the world.

Separating them answers "what did we believe at time T" as distinct from "what was true at time T",
which is the basis for stale-decision detection and "what changed since X" queries.

Today an atom carries valid time only. Transaction time exists on observations (`observed_at`) and in
git history, but not on knowledge, so the first question can be answered by reading the repository log
and not by querying the store. Completing this is an audit improvement, not a retrieval one, and it
requires a schema migration.

## Causal Relations

**Not implemented.** The intent was that the ledger record causal and temporal links beyond succession
and dispute, so memory could reconstruct why a decision was made and what conditions held when a task
failed. Nothing of the sort exists: no causal relation type is defined in the schema, and no code path
writes one.

The nearest thing that does exist is authored rather than inferred — `why`, `alternatives`,
`assumptions` and `revisit_when` on the atom itself carry the reasoning the causal graph was meant to
reconstruct.

## Claim Surface vs Evidence Deep-Fetch

To bound retrieval cost, retrieval first returns compact claims (the "claim surface"). Full evidence capsules are fetched only for top candidates or high-risk queries. This keeps verification from inflating p95 latency on every lookup.
