---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: implemented
last_validated: 2026-09-10
depends_on:
  - specs/2026-09-09-retrieval-hot-path-and-scale.md
  - memory/lifecycle-policies.md
  - memory/contradiction-supersession.md
  - failures/context-explosion.md
used_by:
  - specs/2026-09-10-memory-quality-and-performance-tests.md
  - superpowers/plans/2026-09-10-memory-deterioration-detection.md
---

# Memory deterioration detection (data only)

Date: 2026-09-10
Status: **Implemented** (detection-only). LLM prune and auto-archive stay deferred.

## Context

SuperMem's thesis is **few memories, expensive to write, cheap to read, activated by the next action**. Retrieve is now O(hits). Forgetting is still missing. A bloated live set will not melt retrieve, but it will fill the 8-hit cap with noise.

This spec defines **deterioration** so a detector can fire from SQLite counts and telemetry. No model in the loop. A later pass may hand the report to the host LLM to prune; detection must work first, including on a store that has never been retrieved.

## What deterioration is not

- Not "old". Canonical unused lessons can stay. Recency decay (`-0.005/day`) fights trigger activation and is out of scope.
- Not "many git files". Archive/superseded history is the audit trail.
- Not "many atoms with the same `topic_key`". The live unique index already forbids two `candidate`/`active` atoms on one key. Same-key pileup is supersession history, not two live lessons.
- Not capture failure. Unreviewed observations are reported separately and **do not** change `status`.
- Not an LLM judging whether a lesson is still true.

## Definition

**Deterioration** = the live set (`active` + `contested`) no longer satisfies the thesis.

Two layers (approach C):

| Layer | When it runs | Question |
|---|---|---|
| **A — store shape** | Always. Atoms table only. | Is the live set too big, crowded, colliding, dead, contested, or churning? |
| **B — retrieve behavior** | Only with enough `memory_retrieval_events`. | Is retrieve no longer selective (cap always full)? |

Overall `status` is the worst layer-A/B indicator that is not `skipped`: `deteriorated` > `watch` > `healthy`. `skipped` does not count.

## Layer A indicators

Live set = `lifecycle_state IN ('active', 'contested')`. Candidates are counted in the snapshot but do not drive A except as noted.

### 1. `live_bloat`

- Metric: `count(active) + count(contested)`
- `watch` if `>= 80`
- `deteriorated` if `>= 200`

Target live set is tens to low hundreds (retrieval hot-path spec).

### 2. `prefix_crowding`

- Prefix = first **2** segments of `topic_key` (`domain/area`)
- Metric: max live count in any prefix
- `watch` if `>= 12`
- `deteriorated` if `>= 25`
- Offenders: prefixes over watch, with atom ids (cap 20)

This is the real "many entries of one topic": uniqueness allows `memory/admission/cap-1` … `cap-N`.

### 3. `trigger_collision`

- Tokens = `contentTokens(trigger)` from `src/engine/v4/trigger-match.js` (stopwords already gone)
- Pair score = Jaccard of token sets. Do **not** treat substring containment as 1; that is retrieve activation, not collision.
- A pair collides if Jaccard `>= 0.5` and both atoms are live
- Metric: number of colliding pairs
- `watch` if `>= 1`
- `deteriorated` if `>= 8`
- Offenders: pairs `{id_a, id_b, jaccard, triggers}` (cap 20)

O(n²) over the live set is acceptable at hundreds; do not scan archive.

### 4. `dead_inferred`

- Predicate: `authority IN ('inferred', 'observed')` AND `activation_count = 0` AND age(`created_at`) `>= 14` days AND live
- Canonical and validated never qualify
- Metric: count
- `watch` if `>= 5`
- `deteriorated` if `>= 20`
- Offenders: atom ids (cap 20)

### 5. `unresolved_contest`

- Predicate: `lifecycle_state = 'contested'` AND `contested_at` age `>= 7` days
- Metric: count
- `watch` if `>= 1`
- `deteriorated` if `>= 3`

### 6. `supersession_churn`

- Metric: max number of `superseded` atoms sharing one `topic_key`
- `watch` if `>= 3`
- `deteriorated` if `>= 5`
- Offenders: `topic_key` values over watch

A topic rewritten five times is churn even if only one live atom remains.

## Layer B indicators

Read `memory_retrieval_events` for the project, newest first, window **50**. If the window has **< 10** rows, every B indicator is `skipped` with `reason: 'insufficient_telemetry'`.

### 7. `cap_saturation`

- Metric: fraction of window events whose `returned_atom_ids` JSON array length is `>= 8`
- Abstentions (length 0) count as not saturated
- `watch` if `>= 0.2`
- `deteriorated` if `>= 0.5`

This confirms A: crowding is already eating the injection cap.

No other B indicators in this cut (no use-feedback, no "was this hit useful").

## Observation backlog (hygiene, not status)

Include in the report, do not fold into `status`:

- `count` of `memory_observations` with `promotion_status = 'unreviewed'`
- `oldest_at` if count > 0

## Report shape

```text
project_id, generated_at, status,
live: { active, contested, candidate, superseded, archived, rejected, total },
indicators: [{
  id, layer, status,          // healthy | watch | deteriorated | skipped
  value, watch_at, deteriorated_at,
  reason?,                    // e.g. insufficient_telemetry
  offenders                   // cap 20
}],
observations: { unreviewed, oldest_at }
```

No `what`, `why`, `evidence_refs`, or retrieval forms. Detection is ids + metrics.

## Runtime constraints

- Read SQLite only. Select compact columns, not `payload`.
- Must **not** call `retrieveMemories` (that bumps `activation_count` and writes retrieval events).
- Must **not** write git atoms, registry, or relations.
- Must **not** call an LLM.
- Thresholds live in `DEFAULT_CONFIG.health` so a later config file can override; engine defaults match this spec exactly.
- `now` is injectable for tests.

## Out of scope

- Auto-archive, auto-reject, or any lifecycle write
- Asking the model to prune (consumer of this report)
- Embeddings / semantic near-duplicate detection
- Use-feedback
- Observation → Stop candidate
- Decay of canonical/validated atoms
- Audit UI charts (CLI + MCP is enough)

## Success

- A store with 3 live non-colliding lessons is `healthy` with zero retrieve events (B skipped).
- 30 live atoms under `memory/admission/*` trips `prefix_crowding` to `deteriorated` without retrieve history.
- Two live triggers `before writing durable memory` and `before writing tests` (Jaccard on `{writing,durable,memory}` vs `{writing,tests}` = 1/4) do **not** collide; two triggers sharing ≥ half their content tokens do.
- 10 retrieve events that each return 8 ids trip `cap_saturation` to `deteriorated` and overall `deteriorated`.
- 9 retrieve events leave B `skipped`; overall follows A only.
- Running detection does not change git files or `activation_count`.

## Tests

Full catalog (gate / stress / cut / later): `docs/specs/2026-09-10-memory-quality-and-performance-tests.md`.

`cut` rows D1–D21 and P9–P13 landed. `npm test` and `npm run test:stress` must stay green. Host traces (H1–H5) and catalog `later` rows remain out of this cut.
