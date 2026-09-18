---
artifact_class: authored
owner_domain: memory
artifact_type: reference
stability: draft
last_validated: 2026-09-17
depends_on:
  - memory/evidence-ledger.md
  - architecture/plugin-constraints.md
used_by: []
do_not_co_load_with: []
---

# Contradiction and Supersession

> Scope: DD is a harness plugin. Everything here operates inside
> [the plugin constraints](../architecture/plugin-constraints.md).

Summary: how the write path handles two collision types — supersession (temporal succession) and
contradiction (mutual exclusion at the same valid-time) — including the contested lifecycle, the
live-topic unique index, the inference boundary and the audit trail.

Sections marked **Not implemented** describe intent the code does not carry. They are named here
because the gap is load-bearing, not to imply it is close. Tracked in [the roadmap](roadmap.md).

## Contradiction vs Supersession

These two resolve differently and must not be conflated.

**Supersession** occurs when a newer claim replaces an older one because the world moved on. Both
claims were true at their own valid-times; there is no loser. The old atom transitions to
`superseded`, the new atom becomes effective, a `supersedes` relation is recorded, and history is
preserved.

**Contradiction** occurs when two claims assert about the same valid-time and cannot both be true.
Neither is simply older — they conflict directly. Both sides transition to `contested` and remain
effective until a Level 3 resolution picks a winner. The winner returns to `active`; the loser becomes
`superseded`.

## The Live-Topic Unique Index

`uq_memory_atoms_project_topic_effective` (`src/store/schema.sql`) enforces that at most one atom per
`(project_id, topic_key)` is in `lifecycle_state IN ('active', 'contested')`. The git file store
enforces the same rule independently and throws `live_topic_conflict`.

Consequences:

- Two contradicting memories on the **same** canonical key cannot both be effective. A same-key write
  collision is therefore always a supersession event, never a coexisting contradiction.
- `candidate` atoms are **outside** the predicate, so several candidates may await review on the same
  key at once. The write path lists them explicitly when checking for an equivalent proposal.
- `superseded`, `rejected` and `archived` atoms are also outside the predicate and coexist freely.
- `contested` atoms are **inside** the predicate. A contested pair therefore always spans two different
  topic keys; it cannot exist within one.

A **coexisting** contradiction — two effective atoms on different keys asserting incompatible things —
is necessarily cross-key and requires semantic detection, which is an inference task. See
[Inference Boundary](#inference-boundary).

## Contested Lifecycle

**Entry.** When a caller explicitly declares a contradiction, both named atoms transition to
`contested` and their `contested_at` is set. A `contradicts` relation is written between them. The
declaration is validated structurally only — same project, distinct atoms, same scope, both effective.

**Retrieval.** A selected `contested` atom is prefixed `DISPUTED; do not treat as settled.` and carries
`contradicts` listing its effective opponents, so the agent can see a dispute exists and choose to
abstain.

An injected pack never carries both sides of a contradiction. Once a contested atom is selected, its
opponents are excluded from that same pack: a pack that argues with itself is worse than a smaller one.
The dispute is surfaced *by naming* the opponent, not by injecting it. `superseded` atoms are excluded
from retrieval entirely but stay reachable through the `supersedes` / `superseded_by` relation for
audit.

Retrieval performs no resolution and calls no model. It only surfaces state.

**Exit.** A Level 3 resolution — local human review, with a mandatory rationale — picks the winner. The
winner returns to `active`, the loser becomes `superseded` with `superseded_by` set, `contested_at` is
cleared, and a `resolved` row is appended to the contradiction log. A third atom that was contesting
only the loser returns to `active` as well; atoms with other unresolved disputes stay `contested`.

## Resolution Ranking

The intended precedence order, highest first:

1. **Evidence** — strength and coverage of supporting evidence (see `evidence-ledger.md`).
2. **Temporal validity** — `valid_from` recency; a newer, well-evidenced claim about a changed world
   outranks an older one.
3. **Authority** — registry canonical status.
4. **Predominance** — decaying track-record tiebreaker.

Predominance must never be the primary factor, or repeatedly-chosen positions entrench themselves and
stale decisions become unchallengeable.

The order is implemented in `src/engine/v6/predominance.js` and surfaced to the reviewer:

- **Evidence** is derived from the atom's own `evidence_state.verified_count`, so no caller has to
  enrich an atom before comparing. It counts artifacts whose bytes were checked — integrity coverage,
  never logical support.
- **Authority** reads the shared ladder in `src/engine/authority.js`. Retrieval weights and resolution
  ranks are two projections of one ordered list, so they cannot disagree about which authority
  outranks which; a test asserts that for every pair.
- **Predominance** is incremented by `PREDOMINANCE_WIN_BUMP` on the winner of a human resolution, and
  bounded, so accumulation cannot turn a tiebreaker into a primary signal.

`GET /api/atoms/:id` returns, for each effective opponent, which side the order favours and the tier
that decided it. A total tie is reported as a tie rather than resolved arbitrarily.

**This is advice, not a decision.** `resolveMemories` does not consult the order. It still requires the
local review capability and a written rationale, and the reviewer may pick the side the order does not
favour. Nothing automatic selects a winner.

**Not implemented.** Predominance decay. A track record currently only grows, so a position that won
long ago keeps its nudge indefinitely. The bound limits the damage; it does not remove it.

## Inference Boundary

The write path is fully deterministic and calls no model. This is what lets it run inside an ephemeral
hook process (L1) with no persistent runtime (L2) and no model dependency (L3).

The only contradiction the write path can confirm is one a caller **explicitly declares** against a
named atom. Same-key collisions are handled as deterministic supersession based on a content
comparison, not a judgment.

Deferred, each carrying a constraint problem of its own:

- Background contradiction judge — a model call needing a process that outlives a hook (L2).
- Cross-key semantic auto-discovery and periodic sweep — the same problem, plus L3: without embeddings
  the candidate generation is lexical.
- Automatic scoring of contested pairs into held proposals for review.
- Stale-decision worker.
- Predominance decay — blocked behind predominance being written at all.

## Audit Trail

`memory_contradiction_log` records contradiction events. Columns: `atom_a_id`, `atom_b_id`,
`detection_source`, `action`, `winner_atom_id`, `actor_ref`, `reasons`, `created_at`.

What is actually written today:

| Column | Reality |
|---|---|
| `detection_source` | Only `explicit`. The schema also permits `same_key_supersede` and `worker_llm`; neither is ever written. |
| `action` | Only `contested` and `resolved`. `superseded` is permitted and never written. |
| `winner_atom_id` | Populated on resolution, null on contest. |
| `actor_ref` | **Never populated.** No call site supplies it. |
| `reasons` | Populated. Level 3 resolution requires a rationale, enforced in code. |

**Retention.** Log rows are never deleted. `memory_contradiction_log` is deliberately excluded from the
telemetry prune in `src/store/telemetry.js`: a row is written only when a caller declares a
contradiction or a human resolves one, so the table cannot grow the way the observation and retrieval
logs do, and discarding a resolution would destroy the record of why an effective memory won.

The other three logs — feedback, retrieval events and admission decisions — remain under the telemetry
policy of 90 days or 2000 rows, whichever comes first.

**Not implemented.** One claim earlier versions of this document made is false, recorded here so it is
not repeated: the log is **not** an audit record of supersession. Supersession happens during admission
and writes no log row at all; only explicit contradiction and its resolution are logged.

## Interfaces

There is no HTTP memory API. DD is a plugin: the write path is reached through MCP tools, and review
through the local audit UI.

| Operation | Interface |
|---|---|
| Supersession-aware write | MCP `propose`. Detects a same-key effective atom and sets `replaces`; the swap happens on approval. |
| Revise an existing memory | MCP `propose` with the same `topic_key`. There is **no update in place**: a revision is a new candidate that supersedes on approval, so the effective memory never changes without review. `createToolHandlers` also exposes an `update` handler that merges fields over a stored atom and re-proposes it, but `definition.js` does not register it as a tool, so no caller can reach it. |
| Declare a contradiction | MCP `contradict`. Both sides enter `contested`. |
| List contested pairs | MCP `list` and the audit UI, always project-scoped (INV-01, INV-02). |
| Resolve a contradiction | Audit UI `POST /api/resolve`. Local human review with a mandatory rationale; not reachable from MCP. |

Promotion and resolution require a capability no transport can construct, so no MCP argument and no
model output can reach them. That is the property that makes the rest safe.
