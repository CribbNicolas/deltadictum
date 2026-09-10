---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: draft
last_validated: 2026-06-02
depends_on:
  - architecture/invariants.md
  - memory/memory-v1-to-v10-roadmap.md
  - memory/behavioral-memory-architecture.md
  - memory/memory-admission-control.md
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
  - memory/memory-orchestrator.md
  - memory/retrieval-router.md
  - memory/evaluation-harness.md
  - memory/memory-security.md
used_by: []
do_not_co_load_with: []
---

# Memory V2 Clean Rebuild Design

Status: approved design. This spec authorizes planning for V2 implementation. It does not by itself authorize code changes, schema migration execution, or destructive database operations without an implementation plan and verification gates.

## Purpose

Memory V2 rebuilds Orquesta memory from the current V1/V1.5 row-oriented store into a behavioral memory subsystem. V2 must prove that memory improves future behavior, not merely that the system can store summaries.

The V2 thesis is:

```text
No durable memory is active unless it states when it applies, what future behavior changes, and what evidence justifies it.
```

## Scope

In scope:

- Reset only memory-owned tables.
- Build a clean V2 schema prepared for future V3-V10 evolution.
- Replace or harden `memory-api` routes so every memory path uses V2 behavior gates.
- Implement durable memory writes for `claim`, `decision`, `lesson`, `anti_memory`, and `procedure`.
- Implement observations as non-durable sanitized events.
- Implement evidence references, basic relations, retrieval forms, trigger retrieval, anti-memory warnings/block recommendations, and acceptance tests.

Out of scope:

- Preserving or backfilling existing V1/V1.5 memory rows.
- Resetting non-memory runtime tables for agents, queues, notifications, executions, or global infrastructure.
- Implementing V3 evidence capsules, V5 authority registry, V6 contradiction engine, V7 hybrid retrieval, V8 conservation, V9 federation, or V10 AGI-memory behavior.

## Decisions

- **Discard current memory data.** Existing V1/V1.5 memory is assumed contaminated and is not backfilled into V2.
- **Reset only memory tables.** Destructive migrations must not touch non-memory tables.
- **Use a clean V2 schema.** `memories` is not kept as the durable model. V2 uses explicit tables for atoms, observations, evidence, relations, retrieval forms, admission decisions, retrieval events, and embedding mappings.
- **No V2 bypass.** Every write, update, promotion, retrieval, worker, compaction path, helper, and test path must pass through V2 contracts or an internal function that applies the same rules.
- **Qdrant remains vector backend.** PostgreSQL owns memory metadata and audit state; Qdrant indexes admitted atoms/forms only.
- **V2 implements behavior, not later phases.** The schema may prepare for future temporal, graph, and evidence depth, but later-phase behavior is not implemented prematurely.

## Architecture

V2 is a rebuild of the memory subsystem, limited to `services/memory-api`, memory-owned migrations/tables, and associated routes/tests. The core unit is `memory_atoms`: durable, typed, behavioral memories.

Internal modules:

- `admission/`: computes `write`, `update`, `observe`, `ignore`, `warn`, `block`, or `contest`.
- `observations/`: stores sanitized non-durable events.
- `atoms/`: persists durable behavioral memories.
- `evidence/`: stores V2 evidence references.
- `relations/`: records basic memory graph edges.
- `forms/`: stores `micro`, `short`, and `full` retrieval forms.
- `retrieval/`: filters by project, type, scope, lifecycle, query, and trigger.
- `evaluation/`: provides fixtures, unit tests, integration tests, and HTTP smoke tests.

LLMs may propose memory meaning. Deterministic code validates schemas, scope, permissions, lifecycle transitions, evidence presence, admission outcomes, durable writes, and final retrieval results.

## Data Model

V2 tables:

| Table | Purpose |
|---|---|
| `memory_observations` | Sanitized events that are not durable memory. |
| `memory_atoms` | Durable behavioral memories. |
| `memory_evidence_refs` | Minimal V2 evidence references for atoms. |
| `memory_relations` | Basic graph edges such as support, contradiction, supersession, derivation, and blocking. |
| `memory_retrieval_forms` | `micro`, `short`, and `full` forms used for context assembly. |
| `memory_admission_decisions` | Audit trail for admission decisions and reasons. |
| `memory_retrieval_events` | Retrieval metrics and audit events. |
| `memory_embeddings` | Mapping from atoms/forms to Qdrant point IDs, model, and vector dimensions. |

### `memory_observations`

Stores non-durable events with `project_id`, `source_type`, `source_ref`, `raw_preview`, `observed_at`, `promotion_status`, `sanitization_status`, and `metadata`.

Observations are useful for debugging and promotion, but are never injected as durable memory by default.

### `memory_atoms`

Stores durable memory with:

- `project_id`
- `memory_type`: `claim`, `decision`, `lesson`, `anti_memory`, or `procedure`
- `scope`: `project`, `user`, `agent`, `workflow`, `file`, or `service`
- `title`
- `trigger`
- `behavior_delta`
- `what`
- `why`
- `authority`: `observed`, `inferred`, `validated`, `canonical`, or `deprecated`
- `confidence`
- `valid_from`
- `valid_until`
- `topic_key`
- `tags`
- `lifecycle_state`: `candidate`, `active`, `contested`, `superseded`, `archived`, or `rejected`
- `schema_version`
- `created_at`
- `updated_at`

An `active` atom requires non-empty `trigger`, `behavior_delta`, at least one evidence reference, and minimum retrieval forms `micro` and `short`.

### `memory_evidence_refs`

Stores `atom_id`, `source_type`, `source_ref`, `summary`, `observed_at`, `sensitivity`, and optional `hash`.

This is not the full V3 evidence ledger. It is the V2 minimum needed to prevent unsupported durable memory.

### `memory_relations`

Stores `source_atom_id`, `relation_type`, `target_atom_id`, `confidence`, and `created_at`.

V2 relation types include `supports`, `contradicts`, `supersedes`, `derived_from`, `blocks`, and `related_to`.

### `memory_retrieval_forms`

Stores one or more forms per atom:

- `micro`: one-line activation/warning form.
- `short`: compact context form used by default.
- `full`: complete durable body, fetched only when requested or required.

### `memory_admission_decisions`

Stores normalized input, decision, reasons, score components, risk notes, actor/trace references, and timestamps. It must be written for accepted and rejected attempts so failures are auditable.

### `memory_retrieval_events`

Stores project, query/trigger, filters, candidate IDs, injected IDs, abstention status, latency, selected forms, and timestamps.

### `memory_embeddings`

Stores atom/form to Qdrant point mappings. It records namespace, point ID, embedding model, vector dimensions, and indexed text hash. It does not replace Qdrant.

## API And Admission

V2 exposes explicit endpoints:

- `POST /api/v2/observations`
- `POST /api/v2/memories/admit`
- `POST /api/v2/memories`
- `PATCH /api/v2/memories/:id`
- `GET /api/v2/memories/:id`
- `POST /api/v2/retrieval`
- `POST /api/v2/evaluation/smoke` for local/test environments if useful

Minimum durable payload:

```json
{
  "project_id": "orquesta",
  "memory_type": "lesson",
  "scope": "project",
  "title": "short title",
  "trigger": "when this applies",
  "behavior_delta": "what future agents should do differently",
  "what": "compressed statement",
  "why": "rationale",
  "evidence_refs": [
    {
      "source_type": "test_log",
      "source_ref": "tests/unit/memory-api/example.test.js",
      "summary": "what this evidence proves",
      "sensitivity": "project"
    }
  ],
  "topic_key": "memory/v2/example",
  "tags": ["memory"],
  "retrieval_forms": {
    "micro": "one-line recall",
    "short": "compact context",
    "full": "complete durable body"
  }
}
```

Admission rules:

- Missing `project_id` blocks the attempt.
- Missing `trigger`, `behavior_delta`, or `evidence_refs` prevents durable `active` memory.
- Invalid `memory_type` blocks the attempt.
- Raw `<think>`, markdown fences, raw model wrappers, and injection-like content cannot become `active` memory.
- Duplicate `topic_key` within a project becomes `update`, `contest`, or `block`; it must not silently append.
- Strong contradiction against higher-authority active memory becomes `contest`, not overwrite.
- `anti_memory` requires a concrete preventive trigger and behavior delta.
- `procedure` requires operational behavior or steps in `behavior_delta` or `full` form.
- Durable write creates atom, evidence refs, retrieval forms, admission decision, and embedding mapping as one logical transaction.

Legacy V1 endpoints must be removed, disabled, or routed through V2 admission. No legacy route may create active durable memory outside V2.

## No-Bypass Invariant

The local V2 memory invariant is:

```text
V2 behavior gate is mandatory for all memory paths.
```

This applies to:

- HTTP endpoints.
- Internal route helpers.
- Workers.
- Compaction.
- n8n.
- agent-service.
- future memory-agent flows.
- maintenance/consolidation.
- tests and fixtures.

No code path may write directly to memory tables unless it invokes the same deterministic V2 validation/admission logic.

## Retrieval

Retrieval V2 flow:

```text
project filter
-> type/scope/lifecycle filter
-> trigger/query candidate search
-> evidence/form availability check
-> relation adjustment
-> anti-memory blocking/warning
-> utility-per-token approximation
-> selected retrieval form response
```

Rules:

- `project_id` is mandatory.
- Global retrieval is forbidden.
- `active` is the default lifecycle filter.
- `candidate`, `contested`, `superseded`, and `archived` require explicit request.
- `micro` and `short` are default return forms.
- `full` is returned only when requested or required.
- Every retrieval writes a `memory_retrieval_events` record.

V2 ranking can approximate utility per token using relevance, confidence, authority, lifecycle state, anti-memory priority, recency, and selected form cost. V7 hybrid retrieval is deferred.

## Anti-Memory

`anti_memory` is a durable preventive memory type. It blocks or warns against repeating harmful patterns.

Rules:

- Must include a concrete trigger.
- Must include a preventive `behavior_delta`.
- May relate to other atoms with `blocks`, `contradicts`, or `derived_from`.
- If it strongly matches a trigger/query, retrieval surfaces it before generic lessons.
- It may return `warning` or `block_recommendation` metadata.

V2 does not implement advanced contradiction pressure or automated conflict resolution.

## Sub-Batches

### V2.1 Schema Reset

Drop only memory-owned tables and create the V2 schema. Add constraints, indexes, enums/checks, and tests proving non-memory tables are untouched.

### V2.2 Admission And Durable Writes

Implement admission gate and durable writes for all V2 memory types. Incomplete inputs become observation, candidate, rejected, or blocked, never `active`.

### V2.3 API Hardening And No-Bypass

Audit and harden `memory-api`, legacy routes, workers, compaction, helpers, and tests. Every path must use V2 behavior gates.

### V2.4 Retrieval Forms And Trigger Retrieval

Implement retrieval by project, type, scope, lifecycle, query, and trigger. Return forms by budget/request. Index only admitted atoms/forms in Qdrant.

### V2.5 Anti-Memory And Security

Implement anti-memory warning/block recommendations, sanitization, poisoning resistance checks, and rejection of raw model output as active memory.

### V2.6 Acceptance Harness

Add HTTP smoke tests against `memory-api` proving create/retrieve for `claim`, `decision`, `lesson`, `anti_memory`, and `procedure`; observation creation; invalid payload errors; project isolation; and no active incomplete memory.

## Test Strategy

Each sub-batch must include unit and integration tests. V2 completion requires acceptance tests that call `memory-api` like a real client.

Required proof points:

- Existing memory tables are reset and only memory tables are affected.
- Each durable type can be written and retrieved through API.
- Missing required V2 fields cannot produce `active` atoms.
- Observations do not appear as durable retrieval results by default.
- Legacy/bypass paths cannot create active memory.
- Project isolation holds for write and retrieval.
- Qdrant is updated only for admitted atoms/forms.
- Anti-memory returns warnings/block recommendations for matching triggers.
- Raw `<think>`, markdown fences, raw model output, and injection-like content do not become active durable memory.

Expected commands include:

```text
npm --prefix services/memory-api run test:unit
npm --prefix services/memory-api run test:integration
```

If an npm workspace command is introduced later, it may replace the prefix commands only after proving equivalent coverage.

## Success Criteria

V2 is complete when:

- 100% of V2 tests pass.
- `memory-api` can be called directly at each batch boundary.
- All V2 durable types can be created and retrieved without missing fields.
- Invalid payloads return clear errors or admission decisions.
- No path can bypass the V2 behavior gate.
- Retrieval remains project-scoped and never global.
- Existing V1/V1.5 contamination is not carried into V2.

## Risks

- Destructive reset can remove useful data. Accepted mitigation: current memory data is intentionally discarded as contaminated.
- Legacy code may assume the old `memories` table. Mitigation: V2.3 explicitly audits and hardens all routes, workers, helpers, and tests.
- V10-shaped schema could overfit future needs. Mitigation: V2 stores extensible metadata and relations but does not implement future-phase behavior prematurely.
- Qdrant/Postgres divergence can occur. Mitigation: `memory_embeddings` records indexed atoms/forms and tests verify admitted writes update both stores consistently.

## Approval Record

User approved:

- V2 as sub-batches rather than one large release.
- Clean rebuild with deletion of current memory data.
- Reset limited to memory tables.
- Architecture, data model, API/admission, no-bypass invariant, retrieval, anti-memory, test strategy, and sub-batch scope.
