---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-06-19
depends_on:
  - memory/evidence-ledger.md
used_by: []
do_not_co_load_with: []
---

# Contradiction and Supersession

Summary: Defines how memory handles two write-path collision types — supersession (temporal succession) and contradiction (mutual exclusion at the same valid-time) — including the contested lifecycle, the live-topic unique index, predominance scoring, the inference boundary, the audit trail, and V6a endpoints.

## Contradiction vs Supersession

These two concepts resolve differently and must not be conflated.

**Supersession** occurs when a newer claim replaces an older one because the world moved on. Both claims were true at their own valid-times; there is no "loser." The old atom transitions to `superseded`, the new atom is `active`, a `supersedes` relation is recorded, and history is preserved. The live unique index is freed for the new atom.

**Contradiction** occurs when two claims assert about the same valid-time and cannot both be true. Neither is simply older — they conflict directly. Both sides transition to `contested` and remain live-visible until a Level 3 resolution picks a winner. The winner is then `active` and the loser becomes `superseded`.

## The Live-Topic Unique Index

`uq_memory_atoms_project_topic_live` enforces that only one `candidate` or `active` atom may exist per `(project_id, topic_key)`. This has a direct consequence for contradiction handling:

Two contradicting memories on the **same** canonical key cannot coexist as live atoms. A same-key write collision is therefore always treated as a supersession event (temporal succession), not a coexisting contradiction.

Because `contested` and `superseded` atoms fall outside the index predicate, contested pairs and superseded atoms can coexist freely without violating the constraint.

A **coexisting** contradiction — two live atoms on different keys that assert incompatible things — is necessarily cross-key and requires semantic detection. Semantic detection is an inference task and belongs in V6b, not V6a. See the [Inference Boundary](#inference-boundary) section below.

## Contested Lifecycle

**Entry.** When an explicit contradiction is declared by a caller, both the new atom and the named opposing atom transition to `lifecycle_state = 'contested'` and their `contested_at` timestamp is set. A `contradicts` relation is written between them. Both sides remain visible in retrieval so that a retrieving agent can see the dispute and choose to abstain.

**Retrieval.** A `contested` atom in a retrieval result includes both sides of the dispute: the matched atom and its opposing atom, each flagged `contested: true` with the relation marker. `superseded` atoms are excluded from normal retrieval but remain reachable via the `supersedes` / `superseded_by` relation for audit and history. Retrieval performs no resolution and calls no inference; it only surfaces state.

**Exit.** A Level 3 resolution (human or policy, via the resolution endpoint) picks the winner. The winner's `lifecycle_state` returns to `active` and its `predominance` is bumped; the loser becomes `superseded`. The `contested_at` field is cleared, and a `resolved` row is appended to `memory_contradiction_log`.

## Predominance

`memory_atoms.predominance` (`NUMERIC(5,3)`, default 0) is a per-atom accumulating track-record score. It is bumped each time an atom wins a contested resolution or a supersession event.

Predominance is a **decaying tiebreaker only** — it is the lowest-priority signal in the resolution ranking order and must never be the primary factor, to avoid entrenching stale decisions. The full ranking order that the Level 3 resolution endpoint applies is:

1. **Evidence** — strength and coverage of supporting evidence (primary signal; see `evidence-ledger.md`).
2. **Temporal validity** — `valid_from` / `observed_at` recency; a newer, well-evidenced claim about a changed world outranks an older one.
3. **Authority** — V5 registry canonical status.
4. **Predominance** — decaying track-record tiebreaker.

V6a stores and bumps predominance and applies this order in manual resolution. The decay function and the automatic scorer that applies this order without human involvement are deferred to V6b. The column value is clamped to the column ceiling (`999.999`); exact magnitude beyond the tiebreaker range carries no additional meaning.

## Inference Boundary

V6a is fully deterministic and inference-free: the write path calls no model. This is what lets it run inside a hook process (see [plugin constraints](../architecture/plugin-constraints.md)).

The only inline contradiction V6a can confirm deterministically is one a caller **explicitly declares** against a named atom. Same-key write collisions are handled as deterministic supersession based on a content comparison, not an LLM judgment.

The following capabilities are deferred to V6b:

- Background LLM contradiction judge.
- Cross-key semantic contradiction auto-discovery and periodic semantic sweep.
- Automatic scoring of contested pairs into held resolution proposals for Level 3 review.
- Stale-decision intelligence worker.
- Predominance decay.

V6b routes inference through the background worker queue, keeping the synchronous write path inference-free and avoiding contention on the `--parallel 1` reasoning slot.

## Audit Trail

`memory_contradiction_log` is the append-only audit record for all supersession and contradiction events. Key columns:

- `detection_source` — one of `same_key_supersede` (same-key collision), `explicit` (caller-declared), `worker_llm` (reserved for V6b background judge).
- `action` — one of `contested`, `superseded`, `resolved`.
- `winner_atom_id` — populated on resolution; null for contested entries.
- `actor_ref` — identifies the caller or worker responsible.
- `reasons` — text array capturing the stated rationale (required for Level 3 resolution).
- `created_at` — immutable; log rows are never deleted.

The log is the basis for stale-decision analysis in V6b and satisfies the requirement that Level 3 resolution events leave an auditable trail (`behavioral-memory-architecture.md`, Autonomy Levels).

## V6a Endpoints

- `POST /api/v6/memories` — supersession-aware write; detects same-key collision and applies supersession or update-in-place depending on whether the change is material.
- `POST /api/v6/contradictions/declare` — caller asserts a cross-key contradiction against a named atom; both sides enter `contested`.
- `GET /api/v6/contradictions` — lists open contested pairs for review (always project-scoped; INV-02).
- `POST /api/v6/contradictions/resolve` — Level 3 human/policy resolution; picks the winner, supersedes the loser, bumps predominance, clears `contested_at`, appends a `resolved` log row.

All mutation endpoints are deterministic. Level 3 resolution satisfies the rule (`behavioral-memory-architecture.md`, Autonomy Levels) that resolving strong contradictions and deprecating canonical memory require human or policy review rather than autonomous action.
