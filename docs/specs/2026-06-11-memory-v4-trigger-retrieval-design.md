---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: draft
last_validated: 2026-06-11
depends_on:
  - architecture/invariants.md
  - memory/roadmap.md
  - memory/behavioral-memory-schema.md
  - memory/memory-admission-control.md
  - specs/2026-06-05-memory-v3-evidence-capsules-design.md
used_by:
  - plans/2026-06-11-memory-v4-trigger-retrieval-plan.md
do_not_co_load_with: []
---

# Memory V4 Trigger-Based Retrieval Design

> **Historical design record.** This spec predates the move to a harness plugin and may name
> infrastructure DD does not have (a service write path, an inference queue, a hybrid retriever) and
> invariant numbers that have since changed. It is kept for the reasoning it records, not as a
> description of current behaviour. The boundary in force is
> [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md); current behaviour is
> [`DD.md`](../DD.md).

Summary: V4 shifts retrieval from similarity-only search to action-triggered recall with intent classification, authority/TTL filtering, budgeted forms, and a value-per-token injection gate. Includes a closing review check of V2, V3, and V4 with all tests green against real Postgres.

## Goal

Before executing an action, the agent asks which memories apply. V4 implements the roadmap read path:

```text
task/action/query
-> classify action or intent
-> retrieve by trigger + keyword + embedding + relations
-> filter by project, scope, lifecycle, authority, TTL
-> verify evidence and contradictions
-> assemble micro, short, or full forms
-> inject only if value_per_token exceeds threshold
```

Phase boundary rule applies: no V7 hybrid retrieval (RRF, sparse, rerankers), no V5 authority registry, no GraphRAG/RAPTOR. The existing embedding interface is reused as-is; no new Qdrant query path.

## Architecture

V4 wraps V3 the same way V3 wraps V2. New module `services/memory-api/memory/v4/`:

| Component | Responsibility |
|---|---|
| `intent.js` | Deterministic rule-based intent classifier. No LLM calls. Classes: `factual`, `temporal`, `causal`, `policy`, `debug`, `global`, `abstain`. Keyword/pattern rules over `action` + `query` (Spanish and English). Each intent maps to a retrieval profile: preferred memory types, default form, abstention threshold. Unclassifiable input falls back to `factual`. |
| `trigger-match.js` | Trigger activation scoring 0–1 against the incoming action: normalization (lowercase, strip accents/punctuation), shared-token overlap, substring containment. Improves on the V2 substring-only anti_memory match. |
| `forms.js` | Form selection per candidate: `micro` for activation/warnings, `short` default, `full` only when intent requires evidence or detailed rationale, constrained by remaining `budget_tokens`. |
| `retrieval.js` | Pipeline: classify intent → `retrieveV3Memories` (reuse, includes evidence coverage) → trigger scoring → authority/TTL filters → form selection → value-per-token gate → record retrieval event. |
| `routes/v4-retrieval.js` | `POST /api/v4/retrieval`, mounted in `app.js`. |

## Migration 014

`services/memory-api/migrations/014_memory_v4_trigger_retrieval.sql`:

- GIN index on `to_tsvector('simple', trigger)` over `memory_atoms` for trigger/keyword candidate generation.
- `memory_atoms.activation_count INTEGER NOT NULL DEFAULT 0` — V4 retrieval activation metadata (incremented when an atom is injected).
- `memory_retrieval_events.intent VARCHAR(20)` — classified intent for the event.
- `memory_retrieval_events.value_per_token NUMERIC(8,4)` — gate score of the best injected candidate (NULL on abstention).

Idempotent (`IF NOT EXISTS` style) consistent with migration 013.

## API Contract

```text
POST /api/v4/retrieval
{
  "project_id": "orquesta",          // required (INV-06)
  "action": "string",                // required: action about to execute
  "query": "string",                 // optional free-text
  "budget_tokens": 600,              // optional, default 600, must be > 0
  "memory_types": ["lesson"],        // optional filter
  "scopes": ["project"],             // optional filter
  "include_evidence": false          // optional, V3 passthrough
}

200 {
  "intent": "debug",
  "memories": [{
    ...atom fields, "form_type", "content", "activation_score",
    "evidence_coverage", "recommendation", "value_per_token"
  }],
  "injected": true,                  // false when gate abstains
  "abstained": false,
  "budget": { "requested": 600, "used": 412 }
}
```

## Filtering and Ranking

Strict INV-06 order: project filter → memory type filter → trigger/semantic retrieval → importance ranking → context injection.

- **TTL:** exclude atoms with `valid_until < now()`.
- **Authority:** `deprecated` excluded by default. Ranking weight: `canonical` 1.0 > `validated` 0.85 > `inferred` 0.6 > `observed` 0.5.
- **Lifecycle:** `active` only by default (V3 behavior preserved).
- **Gate:** `value_per_token = activation_score * confidence * authority_weight / token_estimate`. Default threshold `0.005`, configurable via `MEMORY_V4_VPT_THRESHOLD` env var. Candidates below threshold are dropped; if none survive, respond `abstained: true` with empty `memories`. Abstention is preferred over noise injection.
- **Contradictions:** read-only check against existing `memory_relations`: a candidate with an unresolved `contradicts` relation to another active atom is flagged `contested_hint: true` and demoted below non-contested candidates. No new contradiction detection (that is V6).
- **Anti-memory:** retains V2 `block_recommendation`/`warning` semantics; anti-memories matched by trigger always rank ahead of context memories.

## Error Handling

Same `{ error: { code, message } }` pattern as V2/V3:

- 400 — missing `project_id`, missing `action`, or invalid `budget_tokens`.
- Intent classification never fails: unknown input falls back to `factual`.
- V3 errors (including evidence coverage failures) propagate unchanged.
- A retrieval event is recorded on every request, including abstentions (`abstained: true`).

## Testing

TDD per component. New tests:

- `tests/unit/memory-api/v4/` — intent classifier, trigger matcher, form selection, gate, pipeline (mock repository).
- `tests/unit/memory-api/routes/v4-retrieval.test.js` — route contract via supertest.
- `tests/unit/memory-api/migrations/014-memory-v4-trigger-retrieval.test.js` — migration applies cleanly on top of 012+013 (requires `PG_TEST_URL`).
- `test:v4` script added to `services/memory-api/package.json` following `test:v2`/`test:v3` pattern.

## Closing Review Check (V2 + V3 + V4)

1. Start Postgres via docker compose, set `PG_TEST_URL`.
2. Run `test:v2`, `test:v3`, `test:v4`, `test:unit`, `test:integration` — required result: **0 fail, 0 skip**.
3. Doc-by-doc implementation review: V2 against `memory-admission-control.md` + `behavioral-memory-schema.md`, V3 against `evidence-ledger.md`, V4 against the read path recorded in this spec. Any gap is fixed or logged to `.tasks/state/known-issues.md`.
4. Update `.tasks/state/session-resume.md`, `.tasks/state/migration-progress.md`, and `depends_on`/`used_by`/`last_validated` metadata on affected `.docs/memory/` docs.

## Out of Scope

- Real embedding-service integration for V4 semantic scoring (declined; existing V2/V3 search path reused).
- RRF, sparse retrieval, rerankers, corrective retrieval (V7).
- Authority registry canonical keys (V5).
- Contradiction engine beyond existing `memory_relations` data (V6).
