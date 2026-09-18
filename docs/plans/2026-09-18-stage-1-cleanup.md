---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - plans/2026-09-18-stages-index.md
do_not_co_load_with: []
---

# Stage 1 — Cleanup: delete what we are not going to use

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral Node processes; `PreToolUse` runs on every tool call | Nothing warm on the hot path |
| L2 | No guaranteed persistent process; audit UI and MCP server are both optional | No required background worker |
| L3 | Two dependencies (`@modelcontextprotocol/sdk`, `zod`), Node ≥ 22 | **No embeddings, no ML libraries** |
| L4 | The hook contract differs per harness | A veto is not portable |
| L5 | A hook failure must never block the host | Every gate needs a defined failure direction |
| L6 | Single-developer volumes (90 days / 2000 telemetry rows) | No online learning |
| L7 | Local-first: git plus a derived SQLite index | No cross-user aggregation |

## Invariants this stage must not break

From [`architecture/invariants.md`](../architecture/invariants.md):

- Model output never mutates state; promotion happens only through local human review.
- A reported success is telemetry; it never raises authority or confidence.
- Evidence establishes integrity, never entailment.
- Retrieval is project-scoped first.
- One effective memory per `topic_key`.

This stage deletes code. It must not change a single behaviour.

## Starting state

Three modules are imported by **nothing except their own test files**. Verified with
`grep -rl <symbol> src/ tests/`:

| Module | Export | Sole importer |
|---|---|---|
| `src/engine/v3/admission.js` | `decideV3Admission` | `tests/engine/v3/admission.test.js` |
| `src/engine/v3/evidence.js` | capsule validation, `EVIDENCE_ROLES` | `tests/engine/v3/evidence.test.js` |
| `src/engine/v6/supersession.js` | `decideSupersession` | `tests/engine/v6/supersession.test.js` |

`decideSupersession` compares three fields (`behavior_delta`, `what`, `why`). The live path uses
`sameKnowledge` in `src/engine/contract.js:89-93` over the thirteen `MATERIAL_FIELDS` declared at
`contract.js:14-15`. The two disagree, and the one that runs is the second.

`EVIDENCE_ROLES` in the dead v3 evidence module includes a `refutes` role with no consumer. Refutation
already exists elsewhere and is live: `recordOutcome` accepts a `refuted` outcome
(`src/engine/feedback.js:4`), and retrieval reads it at `src/engine/retrieve.js:59`.

Two more declarations without a producer:

- `src/mcp/tools.js` implements an `update` handler. `src/mcp/definition.js` registers ten tools and
  **`update` is not one of them**, so no caller can reach it. (`capture` is also unregistered, but it
  is reached internally: `definition.js` routes `propose` to `handlers.capture`.)
- `ADMISSION_DECISIONS` in `src/engine/v2/constants.js:4` declares `warn`. No code path emits it. The
  decisions actually emitted are `block`, `observe`, `write` and `ignore`.

And one drift: `src/store/schema.sql:23` declares `schema_version INTEGER NOT NULL DEFAULT 6` while
`src/engine/contract.js:5` exports `SCHEMA_VERSION = 7`. Harmless at runtime — every write supplies the
value explicitly — and a trap for the next person who reads the schema.

## What changes, and why

**Delete the three modules and their three test files.** The reason is not tidiness. Their tests are
green, so the modules look like part of the system to anyone reading the repository or grepping it.
That is exactly the failure the documentation pass just fixed, in code instead of prose.

**Delete the `update` handler from `src/mcp/tools.js`.** The alternative — registering it — contradicts
the design. Revisions go through `propose` with the same `topic_key`, which is what guarantees the
effective memory cannot change without review. A second mutation path that merges fields over a stored
atom weakens that for no gain.

**Remove `warn` from `ADMISSION_DECISIONS`.** It has no use while every write already stops at
`candidate`: there is no state between advising and blocking to express.

**Keep `update` in `ADMISSION_DECISIONS`.** Stage 6 emits it.

**Fix the `schema_version` default to 7.**

### What this stage deliberately does not touch

**The SQL `CHECK` constraints stay as they are.** `migrate()` (`src/store/sqlite-index.js:72`) runs
`db.exec(schema.sql)` against `CREATE TABLE IF NOT EXISTS`, so an existing database **does not adopt a
changed CHECK**, and `reindex()` (`src/store/create-store.js:38`) repopulates rows without recreating
tables. Removing an unused enum value would therefore be enforced on new installs and not on old ones —
worse than leaving it. It would need a table-recreation path, which is disproportionate for a value
that costs nothing at runtime.

Document them as reserved instead, in the docs listed below:

- `supports`, `blocks`, `derived_from` — reserved **with a plan**: argumentation and the veto path,
  roadmap phase 3.
- `related_to`, and the `worker_llm` value of `detection_source` — **no producer and none planned.**

## Files

- Delete: `src/engine/v3/admission.js`, `src/engine/v3/evidence.js`, `src/engine/v6/supersession.js`
- Delete: `tests/engine/v3/admission.test.js`, `tests/engine/v3/evidence.test.js`,
  `tests/engine/v6/supersession.test.js`
- Edit: `src/mcp/tools.js` (remove the `update` handler)
- Edit: `src/engine/v2/constants.js` (remove `warn`)
- Edit: `src/store/schema.sql:23` (`DEFAULT 6` → `DEFAULT 7`)
- Edit: `docs/memory/evidence-ledger.md` and `docs/memory/contradiction-supersession.md` (record which
  declarations are reserved with a plan and which have none)

Check whether `src/engine/v3/` and `tests/engine/v3/` become empty and remove the directories if so.

## Tests

This stage writes no new tests; it removes three files' worth. The work is proving nothing else broke.

Before running the suite, confirm no import is left dangling:

```bash
grep -rn "v3/admission\|v3/evidence\|v6/supersession\|decideV3Admission\|decideSupersession\|EVIDENCE_ROLES" src/ tests/
grep -rn "handlers.update\|async update(" src/
```

Both must return nothing. This matters more than usual: a broken import inside a hook **fails silently**
(L5 — hooks must not block the host, so `src/hooks/run.js` swallows the error and exits 0), so a
dangling import would not announce itself. It would simply stop supplying memory.

## Verification

```bash
npm test          # ~200 tests, ZERO failures beyond the known transactions.test.js one
npm run eval      # unchanged: 24/24, f1 1.0, 2182 tokens
```

The test count drops because three test files are gone. No test that existed before may now fail.

The replay number must be **byte-identical**. If the estimated token count moves, something this stage
touched was reachable after all — stop and find out what.

## Risks and what not to do

- **Do not delete `capture` from `src/mcp/tools.js`.** It is unregistered but reachable:
  `definition.js` routes `propose` to it.
- **Do not edit SQL `CHECK` constraints**, for the reason above.
- **Do not "fix" a test to make it pass** after a deletion. If a surviving test fails, something was
  not dead.

## Done when

- The six files are gone and the two greps return nothing.
- `npm test` has zero new failures; `npm run eval` is unchanged.
- The two documents state which reserved declarations have a plan and which do not.
- One commit whose message explains why registering `update` was rejected, not just that it was deleted.

## Depends on / unblocks

Depends on nothing. Unblocks nothing directly — it is independent of stage 2 and precedes stages 3–7 so
that no later stage maintains code it should not.
