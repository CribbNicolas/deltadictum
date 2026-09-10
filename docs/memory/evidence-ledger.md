---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-05-30
depends_on:
  - memory/behavioral-memory-schema.md
used_by:
  - memory/retrieval-router.md
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Evidence Ledger

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

Memory tracks when something was observed and when it is valid.

- `observed_at`: when evidence was captured.
- `valid_from`: when the claim became true or actionable.
- `valid_until`: when the claim stops being true or useful.

## Relations

The ledger supports `supported_by`, `refuted_by`, `supersedes`, `superseded_by`, `contradicts`, `caused_by`, and `effective_during`.

## V2 and V3 Boundary

V2 requires `evidence_refs` as stable references. V3 introduces first-class evidence capsules and stronger validation that referenced evidence exists and is in scope.

## Bitemporal Detail

Durable memory tracks two independent time axes:

- **Transaction time** — `observed_at`: when the evidence was captured by the system.
- **Valid time** — `valid_from` / `valid_until`: when the claim is actually true or actionable in the world.

Separating them answers questions the V1 model cannot: "what did we believe at time T" versus "what was true at time T". This is the basis for stale-decision detection and "what changed since X" queries.

## Causal Relations

Beyond `supported_by` / `refuted_by` / `supersedes`, the ledger records causal and temporal links: `caused_by` and `effective_during`. These let memory reconstruct why a decision was made and what conditions held when a task failed — valuable for autonomous debugging.

## Claim Surface vs Evidence Deep-Fetch

To bound retrieval cost, retrieval first returns compact claims (the "claim surface"). Full evidence capsules are fetched only for top candidates or high-risk queries. This keeps verification from inflating p95 latency on every lookup.
