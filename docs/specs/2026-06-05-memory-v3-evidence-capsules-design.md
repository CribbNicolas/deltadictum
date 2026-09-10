---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: draft
last_validated: 2026-06-05
depends_on:
  - architecture/invariants.md
  - memory/memory-v1-to-v10-roadmap.md
  - memory/behavioral-memory-schema.md
  - memory/evidence-ledger.md
  - memory/memory-admission-control.md
  - memory/evaluation-harness.md
  - memory/memory-security.md
  - specs/2026-06-02-memory-v2-clean-rebuild-design.md
used_by: []
do_not_co_load_with: []
---

# Memory V3 Evidence Capsules Design

Status: approved design. This spec authorizes planning for Memory V3. It does not authorize code changes, schema migration execution, destructive database operations, or production rollout without an implementation plan and verification gates.

## Purpose

Memory V3 turns V2 evidence references into first-class evidence capsules. V2 proved that durable memory must state when it applies, how future behavior changes, and what evidence justifies it. V3 makes the evidence itself independently addressable, reusable, scoped, temporally valid, sensitivity-aware, and auditable.

The V3 thesis is:

```text
No durable memory is active unless it is linked to scoped, verifiable, first-class evidence.
```

## Scope

In scope:

- Add `memory_evidence_capsules` as the canonical V3 evidence entity.
- Add an atom-to-evidence link table so one capsule can support multiple atoms and one atom can have multiple capsules.
- Validate project scope, source reference, temporal validity, sensitivity, and optional content hash before durable activation.
- Promote observations or memory candidates to active atoms only when supporting evidence capsules exist and are valid.
- Return compact claim surfaces by default during retrieval, with evidence deep-fetch only when requested or required by risk.
- Preserve V2 behavior while migrating away from `memory_evidence_refs` as the authority surface.
- Add acceptance tests for missing evidence, cross-project evidence, capsule reuse, sensitivity redaction, temporal validity, and retrieval evidence expansion.

Out of scope:

- Cognitive physics workers such as entropy, homeostasis, anti-memory generation, context-policy tuning, or canonicalization workers.
- V4 trigger indexes beyond the retrieval behavior already present in V2.
- V5 authority registry.
- V6 contradiction engine or automated supersession policy.
- V7 hybrid retrieval router.
- V8 conservation and consolidation workers.
- V9 federation, privacy vaults, or embedding export policy.
- V10 bitemporal causal memory beyond the V3 `observed_at`, `valid_from`, and `valid_until` fields defined here.

## Decisions

- **Evidence capsules are the V3 authority.** `memory_evidence_capsules` owns evidence identity, source metadata, temporal validity, sensitivity, and hash state.
- **V2 refs are not the future source of truth.** `memory_evidence_refs` remains a compatibility surface during migration, or is replaced by a bridge in the implementation plan.
- **Evidence is project-scoped.** A memory atom cannot link to evidence from another project. Cross-project evidence requires an explicit decision artifact before any implementation can allow it.
- **Evidence can be reused.** A single capsule can support, refute, contextualize, or provide supersession basis for multiple atoms.
- **Retrieval separates claim surface from evidence body.** Default retrieval returns memory claims and evidence coverage metadata, not full evidence payloads.
- **Sensitivity is enforced at read time and write time.** Secret or private evidence cannot be expanded for unauthorized callers, even when its linked atom is retrievable.

## Architecture

V3 adds a dedicated evidence layer to the existing V2 memory subsystem. `memory_atoms` remains the durable memory unit. `memory_evidence_capsules` becomes the canonical evidence unit. `memory_atom_evidence` links atoms to capsules with a role that describes how the evidence relates to the claim.

Conceptual flow:

```text
observation / artifact / tool output / test log
-> memory_evidence_capsules
-> memory_atom_evidence
-> memory_atoms
```

Service responsibilities:

- `evidence/`: creates, resolves, validates, redacts, and deep-fetches evidence capsules.
- `admission/`: requires valid supporting evidence before an atom can become `active`.
- `observations/`: remains the non-durable capture surface and may feed evidence capsule creation.
- `atoms/`: persists durable behavioral memories and links them to evidence capsules in the same logical transaction.
- `retrieval/`: returns claim surfaces by default and expands evidence only under explicit or risk-triggered conditions.
- `evaluation/`: verifies V3 evidence behavior through unit, integration, and acceptance tests.

LLMs may summarize evidence, but deterministic code owns validation of project scope, source reference shape, hash status, temporal validity, sensitivity, admission outcome, and retrieval redaction.

## Data Model

V3 adds two canonical tables.

### `memory_evidence_capsules`

Stores independently addressable evidence:

- `id`
- `project_id`
- `source_type`: `test_log`, `tool_output`, `file`, `diff`, `trace`, `decision`, `user_approval`, or `artifact`
- `source_ref`: stable source reference, such as file path, trace ID, decision artifact, test command, or artifact path
- `source_artifact_id`: optional stable artifact identifier when a separate artifact registry exists
- `observed_at`: transaction time when evidence was captured by the system
- `valid_from`: valid time when the supported claim became true or actionable
- `valid_until`: valid time when the evidence stops supporting active use, or null if still valid
- `summary`: concise statement of what the evidence proves or supports
- `hash`: optional source hash for tamper detection
- `hash_status`: `not_checked`, `matched`, `mismatched`, or `unavailable`
- `sensitivity`: `public`, `project`, `private`, or `secret`
- `metadata`: JSON object for source-specific details
- `created_at`
- `updated_at`

### `memory_atom_evidence`

Links atoms to evidence capsules:

- `id`
- `atom_id`
- `evidence_id`
- `role`: `supports`, `refutes`, `context`, or `supersedes_basis`
- `confidence`: confidence that the evidence supports the role
- `created_at`

An active atom requires at least one linked evidence capsule with `role = 'supports'`, the same `project_id`, non-expired validity, and an allowed sensitivity level for storage.

## API Shape

V3 should expose explicit evidence endpoints while preserving the V2 memory endpoints:

- `POST /api/v3/evidence`
- `GET /api/v3/evidence/:id`
- `POST /api/v3/memories`
- `GET /api/v3/memories/:id`
- `POST /api/v3/retrieval`

Minimum evidence capsule payload:

```json
{
  "project_id": "orquesta",
  "source_type": "test_log",
  "source_ref": "npm --prefix services/memory-api run test:v2",
  "source_artifact_id": null,
  "observed_at": "2026-06-05T00:00:00.000Z",
  "valid_from": "2026-06-05T00:00:00.000Z",
  "valid_until": null,
  "summary": "V2 tests passed after evidence-gated memory changes.",
  "hash": null,
  "sensitivity": "project",
  "metadata": {}
}
```

Minimum durable memory payload:

```json
{
  "project_id": "orquesta",
  "memory_type": "lesson",
  "scope": "project",
  "title": "Evidence capsules gate durable memory",
  "trigger": "when creating or promoting durable memory",
  "behavior_delta": "require scoped evidence capsules before activation",
  "what": "Active Memory V3 atoms require linked supporting evidence capsules.",
  "why": "First-class evidence prevents unsupported durable memory and enables audit/deep-fetch.",
  "topic_key": "memory/v3/evidence-capsules",
  "evidence": [
    {
      "evidence_id": "uuid",
      "role": "supports"
    }
  ],
  "retrieval_forms": {
    "micro": "V3 memory must link to scoped evidence capsules.",
    "short": "Do not activate durable V3 memory unless supporting evidence capsules exist and validate in scope.",
    "full": "Memory V3 separates durable atoms from evidence capsules so claims can be audited, reused, redacted, and deep-fetched."
  }
}
```

## Admission Rules

- Missing `project_id` blocks the attempt.
- Missing evidence for an active durable atom returns `observe` for candidate endpoints or `422 evidence_required` for direct durable creation.
- Evidence with a different `project_id` hard-blocks the write.
- Evidence with missing or invalid `source_type`, `source_ref`, `summary`, `observed_at`, `valid_from`, or `sensitivity` blocks durable activation.
- Evidence with expired `valid_until` cannot support an active atom.
- Evidence with `hash_status = 'mismatched'` cannot support a new active atom.
- Secret evidence can support an atom only if storage policy allows it, but its body must not be returned to unauthorized readers.
- Duplicate evidence by `(project_id, source_type, source_ref, hash)` should resolve to the existing capsule instead of creating duplicates when a hash is available.

## Data Flow

Write flow:

```text
POST observation or durable memory candidate
-> sanitize and resolve project context
-> create or resolve evidence capsule
-> validate capsule scope, source, sensitivity, hash, and time bounds
-> run admission decision
-> create memory_atom only if supporting evidence exists
-> link atom to evidence capsule
-> create retrieval forms
-> index admitted atom/forms in Qdrant
```

Read flow:

```text
retrieval request with project_id
-> project-scoped candidate search
-> return compact claim surface by default
-> attach evidence coverage metadata
-> deep-fetch evidence capsules only when requested or risk requires verification
```

Default retrieval response should include evidence coverage metadata such as support count, refute count, highest sensitivity, and whether full evidence is available, without returning the evidence body by default.

## Error Handling

- Missing evidence capsule: `observe` for candidate promotion paths or `422 evidence_required` for direct durable creation.
- Cross-project evidence: `403 evidence_scope_violation` because the request attempts to use evidence outside the resolved project boundary.
- Invalid source reference: `422 invalid_evidence_source`.
- Expired evidence: `422 expired_evidence` for writes and excluded from default active retrieval.
- Hash mismatch: `422 evidence_hash_mismatch` and mark the capsule invalid for future active support.
- Unauthorized evidence expansion: return the memory claim surface with redacted evidence metadata and no evidence body.
- Evidence service/database failure: do not create the atom; write and evidence link must be atomic.

## Testing

Minimum V3 acceptance tests:

- Active memory cannot be created without a supporting evidence capsule.
- Evidence capsule must match the atom `project_id`.
- One evidence capsule can support multiple atoms.
- One atom can have multiple evidence capsules.
- Retrieval returns claim surface without full evidence by default.
- Explicit deep-fetch returns evidence only when sensitivity permits.
- Expired evidence prevents active durable writes and active retrieval support.
- Hash mismatch prevents active durable writes.
- V2 refs compatibility does not create a second source of truth.
- Retrieval and evidence expansion remain project-scoped first.

Verification commands should at minimum include:

```powershell
npm --prefix services/memory-api run test:v2
npm --prefix services/memory-api run test:unit
npm --prefix services/memory-api run test:integration
python scripts/build-index.py --check
```

## Migration Strategy

V3 uses explicit `/api/v3/*` routes and makes `memory_evidence_capsules` authoritative immediately for V3 writes. Existing V2 behavior remains available through `/api/v2/*` until a later cleanup batch removes or redirects it.

No production backfill is required by this spec. Existing V2 evidence refs may be converted into capsules only for deterministic test fixtures. Local V2 memory data can be discarded in the next memory-owned reset unless a future task explicitly decides to preserve it.

`memory_evidence_refs` remains readable as legacy V2 metadata during the V3 batch, but it must not be used as a second authority source for V3 admission or retrieval.

## Success Criteria

Memory V3 is complete when:

- Every active V3 atom has at least one valid supporting evidence capsule.
- Evidence capsules are reusable across atoms without duplication.
- Cross-project evidence links are impossible without an explicit future decision artifact.
- Retrieval defaults to claim surfaces and evidence coverage metadata.
- Evidence deep-fetch respects sensitivity and project scope.
- Invalid, expired, or hash-mismatched evidence cannot activate durable memory.
- V2 compatibility paths are documented and tested without becoming the authority model.

## Planning Decisions

- Cross-project evidence violations return `403 evidence_scope_violation`.
- V3 behavior is exposed through `/api/v3/*` routes instead of schema-version negotiation on `/api/v2/*`.
- Existing local V2 evidence refs are not backfilled by default; test-only conversion is allowed when useful for deterministic fixtures.
