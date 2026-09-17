---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: draft
last_validated: 2026-06-18
depends_on:
  - architecture/invariants.md
  - memory/roadmap.md
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
  - specs/2026-06-11-memory-v5-authority-registry-design.md
used_by:
  - memory/contradiction-supersession.md
do_not_co_load_with: []
---

# Memory V6a Contradiction and Supersession Core

> **Historical design record.** This spec predates the move to a harness plugin and may name
> infrastructure DD does not have (a service write path, an inference queue, a hybrid retriever) and
> invariant numbers that have since changed. It is kept for the reasoning it records, not as a
> description of current behaviour. The boundary in force is
> [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md); current behaviour is
> [`DD.md`](../DD.md).

Summary: V6a is the deterministic, inference-free half of the V6 Contradiction and Supersession Engine. It handles two write-path events without calling the reasoning model — same-key supersession (a new write replaces an existing live memory on the same canonical key) and explicitly declared contradictions (a caller asserts that a new memory contradicts a named atom). It contests declared conflicts, supersedes replaced memories, stores a decaying `predominance` track-record, surfaces contested pairs in retrieval, and exposes Level 3 resolution endpoints. Auto-discovery of novel semantic contradictions and automatic scoring are deferred to V6b, which is where the LLM judge lives.

## Goal

Roadmap V6 introduces contradiction detection, contested states, supersession rules, stale-decision intelligence, and a guarantee that canonical memories cannot be overwritten by LLM output alone. The roadmap entry is large; V6 splits into two shippable batches:

- **V6a (this spec):** deterministic core. Supersession on same-key writes, explicit-relation contradictions, contested lifecycle, predominance store, retrieval surfacing of disputes, and human/policy resolution endpoints. Zero inference.
- **V6b (next spec):** background Conservator-style worker that runs the LLM judge to discover cross-key semantic contradictions, auto-scores contested pairs into resolution proposals (held for Level 3), runs the cross-key semantic sweep, and adds stale-decision intelligence plus predominance decay.

V6a must already change behavior: it stops silent overwrites of live memory, never loses the losing side of a dispute, makes disputes visible to retrieving agents so they can abstain, and records an auditable track-record that V6b's scorer consumes.

## Why V6a Is Inference-Free

Two existing facts make the deterministic core both necessary and sufficient for V6a:

1. **Single inference (INV-03).** memory-api is LLM-free through V2–V5; the caller agent supplies `trigger`, `behavior_delta`, and `evidence`. A synchronous contradiction judge on the write path would be a new inference call contending with the `--parallel 1` reasoning queue and inflating write p95. V6a keeps the write path inference-free; the judge moves to the V6b background worker where inference is queued.

2. **The live-topic unique index.** `uq_memory_atoms_project_topic_live` (migration 012) permits only one `candidate`/`active` atom per `(project_id, topic_key)`. Therefore:
   - Two contradicting memories on the **same** canonical key cannot coexist as live atoms. A same-key write collision is a *supersession* event (temporal succession), not a coexisting contradiction.
   - `contested` and `superseded` are outside the index predicate, so contested pairs and superseded atoms coexist freely.
   - A *coexisting* contradiction is therefore necessarily **cross-key** and semantically detected — which is inherently an inference task and correctly belongs in V6b.

The only inline contradiction V6a can confirm deterministically is one a caller **explicitly declares** against a named atom. Everything else inline is supersession.

## Contradiction vs Supersession

The two cases resolve differently and must not be conflated.

- **Supersession** — a newer claim replaces an older one because the world moved on. Both were true at their own valid-times. There is no "loser"; history is preserved. Old atom → `superseded`, new atom → `active`, `supersedes` relation recorded. Frees the live unique index.
- **Contradiction** — two claims assert about the same valid-time and cannot both be true. Both sides flip to `contested` and stay live-visible until a Level 3 resolution picks a winner. The winner accrues predominance; the loser is then superseded.

## Predominance and Resolution Ranking

`predominance` is a per-atom running track-record (`NUMERIC(5,3)`, default 0) bumped when an atom wins a resolution or supersession. It exists to bias future contradiction resolution toward positions that have repeatedly proven correct — but only as a **tiebreaker**, never the primary signal, to avoid entrenching stale decisions (which would defeat V6's own stale-decision goal).

The documented resolution ranking order is:

1. **Evidence** — strength and coverage of supporting evidence (primary).
2. **Temporal validity** — `valid_from` / `observed_at` recency; a newer, well-evidenced claim about a changed world outranks an older one.
3. **Authority** — V5 registry canonical status.
4. **Predominance** — decaying track-record, tiebreaker only.

V6a **stores and bumps** predominance and applies this order in the manual resolution endpoint. The automatic scorer that applies the full order without a human and the decay function are V6b.

## Data Model Changes

Migration `016_memory_v6_contradiction_supersession.sql`. Additive and re-runnable (`IF NOT EXISTS` / guarded `ALTER`); no `DROP` of existing tables. Tests target the dedicated `orquesta_test` database.

- `memory_atoms.predominance NUMERIC(5,3) NOT NULL DEFAULT 0` — track-record score.
- `memory_atoms.contested_at TIMESTAMPTZ NULL` — set when an atom enters `contested`, cleared on resolution.
- `memory_atoms.superseded_by UUID NULL REFERENCES memory_atoms(id) ON DELETE SET NULL` — direct pointer to the replacing atom (complements the `supersedes` relation row for fast lookup).
- `memory_relations` already allows `contradicts` and `supersedes`; no enum change required. (Inverse `superseded_by` is read off `memory_atoms.superseded_by`, not a relation type.)
- New `memory_contradiction_log` (append-only audit):
  - `id`, `project_id`, `atom_a_id`, `atom_b_id`,
  - `detection_source VARCHAR(20) CHECK (... IN ('same_key_supersede','explicit','worker_llm'))` — `worker_llm` reserved for V6b,
  - `action VARCHAR(20) CHECK (... IN ('contested','superseded','resolved'))`,
  - `winner_atom_id UUID NULL`, `actor_ref TEXT`, `reasons TEXT[]`, `created_at`.

Lifecycle states (`contested`, `superseded`) and the `contest` admission decision already exist in migration 012 and need no schema change.

## Write-Path Behavior

### Same-key collision → supersession

Implemented in the V5/V3 admission + repository path (the layer that already resolves the canonical key and detects the live-index collision).

- When a write's resolved canonical key matches an existing live atom on the same `(project_id, topic_key)`:
  - **Material change or explicit `supersedes` intent in the payload** → supersession: set old atom `lifecycle_state = superseded` and `superseded_by = <new id>` (frees the live unique index), insert the new atom as `active`, write the `supersedes` relation, bump the new atom's `predominance`, record an admission decision and a `same_key_supersede` log row.
  - **Trivial / no material change** → fall through to the existing V2 update-in-place path (decision `update`).
- "Material change" is a deterministic comparison (e.g. changed `behavior_delta` / `what` / opposing value), not an LLM judgment.

### Explicitly declared contradiction → contest

A caller asserts a conflict against a specific atom.

- Payload carries `contradicts: <atom_id>` (cross-key; same-key is handled as supersession above).
- Deterministic validation: both atoms exist, share `project_id`, and have compatible scope. On pass: both atoms → `contested`, set `contested_at`, write the `contradicts` relation, record decision `contest` and an `explicit` log row. On fail: `422` with reason; nothing mutated.
- No inference. The conflict is asserted by the caller, not inferred by memory-api.

## Retrieval Behavior

Extends V4/V5 retrieval; the V4 response contract is extended additively (new optional fields only).

- A `contested` hit returns **both sides** of the dispute: the matched atom plus its related opposing atom, each marked `contested: true` with a relation marker, so the retrieving agent sees the knowledge is disputed and may abstain. Consistent with memory being advisory and the "never silently lose information" rule.
- `superseded` atoms are excluded from normal retrieval results but remain reachable via the `supersedes` / `superseded_by` relation for history and audit.
- Retrieval performs no resolution and no inference; it only surfaces state.

## Endpoints

New `routes/v6-contradictions.js` and supersession route (mounted in `app.js`).

- `POST /api/v6/memories/:id/supersede` — body names the superseded target; performs an explicit Level 3 supersession (old → `superseded`, new/keeper → `active`, relation + predominance bump + log).
- `POST /api/v6/contradictions/:id/resolve` — Level 3 human/policy resolution of a contested pair: picks the winner (applying the documented ranking order as guidance), supersedes the loser, bumps the winner's predominance, clears `contested_at`, writes a `resolved` log row.
- `GET /api/v6/contradictions?state=contested&project_id=...` — lists open contested pairs for review (project-scoped, INV-06).

All mutation endpoints are deterministic and Level 3 (human/policy), satisfying the orchestrator rule that resolving strong contradictions and deprecating canonical memory require review.

## Module Layout

Mirrors the per-version pattern (`memory/vN/`):

- `memory/v6/supersession.js` — same-key supersession decision + transition helpers.
- `memory/v6/contradiction.js` — explicit-contradiction validation + contest transition.
- `memory/v6/predominance.js` — bump + the documented ranking comparator (decay is V6b).
- `memory/v6/repository.js` — wraps V5 repository; adds supersede / contest / resolve mutations and the contradiction log writes; overrides retrieval shaping to surface contested pairs and exclude superseded.
- `routes/v6-contradictions.js` — the endpoints above.

V6a does not add a `memory/v6/admission.js` LLM path; it extends the existing deterministic admission flow.

## Documentation

- New `.docs/memory/contradiction-supersession.md` — reference for the contradiction/supersession model, contested lifecycle, predominance, and the ranking order. Synthesizes the relation and lifecycle content currently spread across `evidence-ledger.md` and the lifecycle documents of the time.
- Update `roadmap.md` V6 section to note the a/b split and what each batch covers.
- Regenerate `.docs/index.md` after the documentation changes.

## Testing

New `test:v6`, serialized with `--test-concurrency=1` (PG-bound; migration 016 and repository share the test DB). Migration tests must point at the dedicated `orquesta_test` database. Integration health test needs `POSTGRES_USER` / `POSTGRES_PASSWORD` env vars.

- **Unit:** same-key supersession transition and relation/predominance writes; trivial-change fall-through to update; explicit-contradiction contest transition; explicit-contradiction validation failures (missing atom, cross-project, scope mismatch); predominance bump; resolution ranking comparator order; retrieval surfacing of both contested sides; superseded exclusion from normal results.
- **Integration:** write → supersede → retrieve (old hidden, reachable by relation); declare contradiction → both contested → retrieval returns both flagged → resolve → loser superseded, winner predominance bumped, log rows present.
- **Regression:** V2 (53), V3 (56), V4 (45), V5 (43), unit (248), integration (2) suites must stay green.

## Out of Scope (deferred to V6b)

- LLM contradiction judge and any synchronous or background inference.
- Cross-key semantic contradiction auto-discovery and the periodic semantic sweep.
- Automatic scoring of contested pairs into held resolution proposals.
- Stale-decision intelligence worker and predominance decay.
- Any change to project isolation, namespace isolation, evidence requirements, or deterministic state governance — these are preserved.
