---
artifact_class: authored
owner_domain: memory
artifact_type: schema
stability: draft
last_validated: 2026-06-12
depends_on:
  - memory/memory-admission-control.md
used_by:
  - specs/2026-06-11-memory-v5-authority-registry-design.md
  - memory/evidence-ledger.md
do_not_co_load_with: []
---

# Behavioral Memory Schema

> Scope: DD is a harness plugin. Everything here operates inside
> [the plugin constraints](../architecture/plugin-constraints.md).

Summary: Target durable memory shape for V2 and phased expansion through V10.

## V2 Minimum Durable Memory

```json
{
  "id": "uuid",
  "project_id": "dd",
  "memory_type": "claim|decision|lesson|anti_memory|procedure",
  "scope": "project|user|agent|workflow|file|service",
  "title": "short searchable title",
  "trigger": "when this memory becomes relevant",
  "behavior_delta": "what future agents should do differently",
  "what": "compressed statement",
  "why": "rationale",
  "evidence_refs": ["artifact-or-trace-ref"],
  "authority": "observed|inferred|validated|canonical|deprecated",
  "confidence": 0.0,
  "valid_from": "timestamp",
  "valid_until": null,
  "supersedes": [],
  "contradicts": [],
  "topic_key": "stable/key",
  "tags": [],
  "retrieval_forms": {
    "micro": "single-line recall form",
    "short": "compact context form",
    "full": "complete durable memory body"
  },
  "lifecycle_state": "candidate|active|contested|superseded|archived|rejected"
}
```

## Observation Shape

Observations can be stored with weaker requirements. They are not durable memory until promoted by admission policy.

```json
{
  "id": "uuid",
  "project_id": "dd",
  "observation_type": "trace|artifact|tool_output|test_result|user_statement",
  "summary": "sanitized short observation",
  "source_ref": "trace-or-artifact-ref",
  "observed_at": "timestamp",
  "promotion_status": "unreviewed|candidate|promoted|rejected"
}
```

## Type Boundaries

| Type | Meaning |
|---|---|
| `claim` | Verifiable statement about the project or system. |
| `decision` | Accepted architecture or implementation decision. |
| `lesson` | Reusable behavior improvement learned from success or failure. |
| `anti_memory` | Preventive memory that blocks or warns against repeating a harmful pattern. |
| `procedure` | Reusable operational sequence. |

## Phase Expansion

V3 adds stronger evidence objects. V4 adds trigger indexes and retrieval activation metadata. V5 adds authority registry IDs. V6 adds contradiction and supersession metadata. V7 adds retrieval feature scores. V8 adds conservation metadata. V9 adds vault and export metadata. V10 adds bitemporal, causal, and multimodal references.

## Deferred Types

V2 ships six durable types. `preference` and `policy` are deliberately deferred, not removed:

- `preference` — how a user or team prefers to work.
- `policy` — a rule that governs behavior (often read-only, high authority).

They are deferred because V2 must first prove the admission gate and the six core types. They re-enter in later phases (policy memory aligns with V9 read-only policy vaults).

## Reuse-Contract Fields

The schema expresses the reuse contract through existing fields, no new columns required for V2:

- `trigger` — when the memory activates.
- `behavior_delta` — what changes next time.
- `valid_until` (or a `why`-embedded invalidation note) — when it stops applying.

A durable memory missing `trigger` or `behavior_delta` cannot satisfy its reuse contract and is downgraded to observation.
