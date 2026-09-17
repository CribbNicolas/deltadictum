---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: draft
last_validated: 2026-06-12
depends_on:
  - architecture/invariants.md
  - memory/roadmap.md
  - memory/behavioral-memory-schema.md
  - specs/2026-06-11-memory-v4-trigger-retrieval-design.md
used_by:
  - plans/2026-06-11-memory-v5-authority-registry-plan.md
do_not_co_load_with: []
---

# Memory V5 Authority Registry Design

> **Historical design record.** This spec predates the move to a harness plugin and may name
> infrastructure DD does not have (a service write path, an inference queue, a hybrid retriever) and
> invariant numbers that have since changed. It is kept for the reasoning it records, not as a
> description of current behaviour. The boundary in force is
> [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md); current behaviour is
> [`DD.md`](../DD.md).

Summary: V5 introduces library-style authority control over memory naming: canonical topic keys with stable registry IDs, aliases (including renames and es/en translations), controlled vocabularies for key format/domain segments/tags, and a deterministic heading-proposal endpoint. The registry normalizes the write path and expands the V4 read path so queries using old or translated names still recall canonical memories.

## Goal

Stop naming drift and improve cross-session recall (roadmap V5). Today `topic_key` is free text (`VARCHAR(200)`, unique per `(project_id, topic_key)`); nothing prevents `memory/compaction`, `compaction-memory`, and `compactacion` from fragmenting the same topic across atoms. V5 makes naming an owned, governed concern:

- Every topic key resolves to a registry entry with a stable UUID.
- Aliases, renames, and translations map alternate names to one canonical key.
- Controlled vocabularies constrain key format, domain segments, and tags.
- New names enter via deterministic proposals — "IA proposes, system disposes"; memory-api stays LLM-free (V2–V4 pattern preserved).

Phase boundary rule applies: no contradiction/supersession of memory content (V6), no authority-scoring changes to ranking (V4 weights kept), no RRF/sparse/hybrid retrieval (V7), no conservation workers (V8), no cross-project registry (INV-02).

## Architecture

New module `services/memory-api/memory/v5/`. V5 wraps the V3 write path (as V4 wrapped the V3 read path) and plugs into V4 retrieval via dependency injection.

| Component | Responsibility |
|---|---|
| `repository.js` | DB access for registry entries, aliases, vocabularies, proposals. |
| `resolver.js` | `resolve(project_id, key)` → canonical entry + aliases. Normalization: lowercase, trim, strip accents. An alias hit returns the canonical key and registry id. |
| `vocab.js` | Format rule: lowercase slash-path, depth 2–4, segments matching `[a-z0-9_-]+`. First segment (domain) validated against the project domain vocabulary; tags validated against the project tag vocabulary. |
| `proposals.js` | Deterministic proposal gate: validate format and collisions, auto-approve safe kinds, hold risky kinds pending. No LLM calls. |
| `expander.js` | Read-path expansion: scan `action`/`query` text for alias occurrences → return canonical keys + sibling aliases as extra candidate terms for V4 trigger/keyword matching. |
| `admission.js` | Write wrapper around V3 admission: vocab format check → alias resolution (canonical substituted into `topic_key`) → unknown key auto-registered as `provisional` → `registry_key_id` attached → delegate to V3 unchanged. |
| `routes/v5-registry.js`, `routes/v5-memories.js` | New endpoints, mounted in `app.js`. |

Decisions fixed during brainstorming:

- **Scope:** full roadmap scope — canonical keys, aliases, renames, translations, controlled vocabularies, heading proposals.
- **LLM role:** none inside memory-api. Agents/callers POST proposals; a deterministic gate validates and commits. A future cataloger agent lives outside this service.
- **Write policy:** unknown topic keys auto-register as `provisional` registry entries. V2/V3 write paths keep working; promotion to `canonical` is explicit.
- **Vocabulary coverage:** key format + domain segment + tags. `memory_type` and `scope` are already DB-enforced and unchanged.
- **Read path:** integrated into V4 retrieval now (not deferred to V7).

## Migration 015

`services/memory-api/migrations/015_memory_v5_authority_registry.sql` — idempotent (`IF NOT EXISTS` style) consistent with 013/014:

```sql
topic_registry        (id UUID PK, project_id, canonical_key, status provisional|canonical|deprecated,
                       notes, created_at, updated_at, UNIQUE(project_id, canonical_key))
topic_aliases         (id UUID PK, registry_id FK ON DELETE CASCADE, project_id, alias,
                       kind alias|rename|translation, lang NULL, created_at,
                       UNIQUE(project_id, alias))
registry_vocabularies (id UUID PK, project_id, kind domain|tag, value, status active|deprecated,
                       created_at, UNIQUE(project_id, kind, value))
registry_proposals    (id UUID PK, project_id,
                       proposal_type new_key|promote|alias_add|rename|deprecate|vocab_add,
                       payload JSONB NOT NULL, status pending|auto_approved|approved|rejected,
                       reason TEXT, proposed_by VARCHAR, created_at, resolved_at)

ALTER TABLE memory_atoms ADD COLUMN registry_key_id UUID NULL REFERENCES topic_registry(id);
ALTER TABLE memory_retrieval_events ADD COLUMN topic_expansion JSONB NULL;
```

**Backfill (inside 015):**

1. Insert distinct `(project_id, topic_key)` from `memory_atoms` into `topic_registry` as `provisional`.
2. Point `memory_atoms.registry_key_id` at the matching entry.
3. Seed the domain vocabulary from distinct first segments of existing keys as `active` — otherwise existing keys would fail validation on day one.

**Rename semantics:** the registry `id` is stable. A rename mutates `canonical_key` on the same entry and inserts the old key as an alias with `kind='rename'`. Atoms' `registry_key_id` is untouched — this stability is why the schema doc says "V5 adds authority registry IDs". A translation is an alias with `kind='translation'` and `lang` set (e.g. `es`).

All tables are project-scoped; cross-project resolution is forbidden (INV-02, INV-06, AG-04).

## API Contract

```text
POST /api/v5/registry/resolve
  { "project_id": "orquesta", "key": "string" }
  200 { "found": true, "registry_id": "uuid", "canonical_key": "memory/compaction/non_empty_raw",
        "status": "canonical", "aliases": [{ "alias": "...", "kind": "translation", "lang": "es" }] }
  200 { "found": false }            // unknown key — not 404; callers probe constantly

GET  /api/v5/registry?project_id=&status=            // list entries with aliases
GET  /api/v5/registry/vocabularies?project_id=&kind=

POST /api/v5/registry/proposals
  { "project_id": "orquesta", "proposal_type": "alias_add", "payload": { ... }, "proposed_by": "agent-id" }
  201 { "id": "uuid", "status": "auto_approved|pending|rejected", "reason": null }

PATCH /api/v5/registry/proposals/:id
  { "status": "approved" | "rejected" }
  200 — approved proposals are applied deterministically on this transition

POST /api/v5/memories
  // same body as the V3 write contract; V5 admission wrapper applied, then V3 delegated unchanged
```

## Proposal Auto-Approve Matrix

Deterministic; maps to the autonomy levels in `behavioral-memory-architecture.md`.

| Proposal | Outcome |
|---|---|
| `new_key` (provisional), `alias_add` targeting a provisional entry, `vocab_add` of a tag | `auto_approved` when format + collision checks pass (Level 2) |
| `promote` (provisional→canonical), `rename`, `deprecate`, `alias_add` targeting a canonical entry, `vocab_add` of a domain | `pending` — requires human/policy PATCH (Level 3) |
| Any format violation, alias/key collision, unknown target | `rejected` with `reason` |

## Write Path

`POST /api/v5/memories` flow:

```text
payload
-> vocab format check (lowercase slash-path, depth 2–4, domain in vocabulary, tags in vocabulary)
-> resolver: topic_key is alias? substitute canonical key
-> resolver: key unknown? auto-register provisional registry entry
-> deprecated key? reject 422 (the entry's `notes` field may document a replacement)
-> attach registry_key_id
-> delegate to V3 admission unchanged
```

V2/V3 endpoints are untouched (same phase-boundary discipline V4 used). Existing data is covered by the 015 backfill; new writes should move to `/api/v5/memories`.

## Read Path (V4 Integration)

- `expander.js` is injected into the V4 retrieval pipeline as an optional dependency wired in `app.js` — no hard V4→V5 module coupling.
- Expansion: alias text found in `action`/`query` → canonical key + sibling aliases added to the trigger/keyword candidate terms. A Spanish query hits English-keyed memories via `translation` aliases.
- The V4 response contract is unchanged. Expansion details are logged to `memory_retrieval_events.topic_expansion` for the evaluation harness.
- Deprecated keys still match at retrieval time; injection is governed by the atoms' own authority/TTL filters (V4 behavior preserved).
- Expander failures degrade soft: log and proceed without expansion; retrieval never fails because of the registry.

## Error Handling

Same `{ error: { code, message } }` pattern as V2–V4:

- 400 — missing `project_id`, missing `key`/`proposal_type`, malformed payload.
- 422 — vocabulary violations: bad key format, unknown domain segment, unknown tag, alias collision, write to a deprecated key (error message includes the entry's `notes` when present).
- 404 — proposal id not found on PATCH. (`resolve` on an unknown key returns 200 `{ found: false }`.)
- 409 — PATCH on an already-resolved proposal.

## Testing

TDD per component:

- `tests/unit/memory-api/v5/` — resolver, vocab validator, proposal gate (full auto-approve matrix), expander, admission wrapper (mock repository).
- `tests/unit/memory-api/routes/v5-registry.test.js`, `v5-memories.test.js` — route contracts via supertest.
- `tests/unit/memory-api/migrations/015-memory-v5-authority-registry.test.js` — applies cleanly on top of 012–014, backfill assertions (requires `PG_TEST_URL` → dedicated `orquesta_test` DB).
- V4 expansion integration test: a query using an alias retrieves an atom stored under the canonical key.
- `test:v5` script in `services/memory-api/package.json` following the `test:v2`–`test:v4` pattern.

## Closing Review Check (V2–V5)

1. Start Postgres via docker compose, set `PG_TEST_URL` (orquesta_test DB).
2. Run `test:v2` through `test:v5`, `test:unit` (`--test-concurrency=1`), `test:integration` — required result: **0 fail, 0 skip**.
3. Doc-by-doc review: V5 against `roadmap.md` and the autonomy levels in `behavioral-memory-architecture.md`. Gaps fixed or logged to `.tasks/state/known-issues.md`.
4. Update `.tasks/state/session-resume.md`, `.tasks/state/migration-progress.md`, and `depends_on`/`used_by`/`last_validated` on affected `.docs/memory/` docs.

## Out of Scope

- LLM cataloger agent — heading generation stays outside memory-api; only the proposal endpoint ships.
- Contradiction/supersession of memory content (V6). V5 renames keys, never atom bodies.
- Authority-scoring changes to retrieval ranking (V4 weights kept as-is).
- RRF, sparse retrieval, hybrid routing (V7); conservation workers (V8).
- Cross-project registry or shared vocabularies (INV-02 violation).
