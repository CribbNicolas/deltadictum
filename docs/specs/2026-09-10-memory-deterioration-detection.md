---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: implemented
last_validated: 2026-09-18
depends_on:
  - specs/2026-09-09-retrieval-hot-path-and-scale.md
  - memory/contradiction-supersession.md
  - failures/context-explosion.md
used_by:
  - specs/2026-09-10-memory-quality-and-performance-tests.md
  - superpowers/plans/2026-09-10-memory-deterioration-detection.md
---

# Memory deterioration detection (data only)

Date: 2026-09-10
Status: **Implemented**. Detection-only until 2026-09-18, when stage 7 promoted one indicator to an
action; see *What stopped being detection-only* below. LLM prune stays deferred.

## Context

DeltaDictum's thesis is **few memories, expensive to write, cheap to read, activated by the next action**. Retrieve is now O(hits). Forgetting is still missing. A bloated live set will not melt retrieve, but it will fill the 8-hit cap with noise.

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
- Also carries `retirable`: the subset that stage 7 would retire (see below). Diagnosis and action are
  reported together, but they are not the same predicate and not the same numbers. Both read the same
  selector, so the report cannot name a memory the sweep would decline to touch.

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

## What stopped being detection-only (2026-09-18)

Stage 7 promoted `dead_inferred` from diagnosis to action: a memory it describes can now be archived.
This is the only lifecycle write this spec's machinery causes, and it is deliberately narrow.

**Retirement is by disuse, not by age.** This reconciles with "Not 'old'" above rather than overturning
it. Age alone justifies nothing: a lesson about a subsystem nobody touched this quarter is still
correct and will be right the day that subsystem comes up. What justifies retirement is that the
trigger **had chances to fire and never did**, so the criterion adds an opportunity count — retrievals
this project ran *after* the memory was written — to the `dead_inferred` conjunction. No recency decay
was added; none is planned.

Retirement has its own thresholds, in `DEFAULT_HEALTH_THRESHOLDS.retirement`, deliberately far above
`dead_inferred`'s: a warning and an irreversible-feeling action should not share a number.

| | Default | Meaning |
|---|---|---|
| `min_age_days` | 90 | Six times the age at which the indicator merely warns |
| `min_retrieval_events` | 40 | Of the ≤ 50 retrievals the snapshot holds, this many postdate the memory |

Constraints the action inherits:

- **Authority protects.** Only `inferred` and `observed` are reachable. A human put `validated` or
  `canonical` there; crowding caused by reviewed knowledge is a review decision.
- **Nothing before a reviewer is retired.** A `contested` memory is excluded — a dispute is a human's
  open question, not disuse — and so is one a pending candidate names in `replaces`. Retiring a
  revision target would leave a candidate `admitMemory` can never approve, and the write path proposes
  revisions and sweeps in the same call, so this is reachable in one operation rather than by a race.
- **Archiving is not deleting.** The file moves to `archive/`, the memory leaves the retrieval surface
  and the effective-set uniqueness predicate, and the audit UI can restore it. Deletion stays manual
  and confirmed. Because the unique index covers only `active` and `contested`, archiving frees the
  `topic_key`; if another memory has taken it, restoring is refused rather than duplicating a trigger.
- **Lazy, never a worker.** Evaluated on the write path, which already holds the lock (L2). Never on
  `PreToolUse` (L1). A failure to retire anything cannot fail the write that swept (L5).

`cap_saturation` remains the judge of whether any of this was needed. On the repository where it
shipped, that indicator was `skipped` for want of telemetry and `dead_inferred` was 0 — the mechanism
was shipped with thresholds that almost never fire, and the benefit is a pending measurement.

## Out of scope

- Auto-reject, or any lifecycle write other than the retirement above
- Asking the model to prune (consumer of this report)
- Embeddings / semantic near-duplicate detection
- Use-feedback
- Observation → Stop candidate
- Decay of canonical/validated atoms, and recency decay of anything
- Audit UI charts (CLI + MCP is enough)

## Success

- A store with 3 live non-colliding lessons is `healthy` with zero retrieve events (B skipped).
- 30 live atoms under `memory/admission/*` trips `prefix_crowding` to `deteriorated` without retrieve history.
- Two live triggers `before writing durable memory` and `before writing tests` (Jaccard on `{writing,durable,memory}` vs `{writing,tests}` = 1/4) do **not** collide; two triggers sharing ≥ half their content tokens do.
- 10 retrieve events that each return 8 ids trip `cap_saturation` to `deteriorated` and overall `deteriorated`.
- 9 retrieve events leave B `skipped`; overall follows A only.
- Running detection does not change git files or `activation_count`. Retirement is a separate call on
  the write path; `assessDeterioration` itself still writes nothing.

## Tests

Full catalog (gate / stress / cut / later): `docs/specs/2026-09-10-memory-quality-and-performance-tests.md`.

`cut` rows D1–D21 and P9–P13 landed. `npm test` and `npm run test:stress` must stay green. Host traces (H1–H5) and catalog `later` rows remain out of this cut.
