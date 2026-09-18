---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: implemented
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - specs/2026-09-10-memory-deterioration-detection.md
  - plans/2026-09-18-stage-3-measurement.md
  - plans/2026-09-18-stage-6-trigger-collisions.md
do_not_co_load_with: []
---

# Stage 7 — Forgetting: reach `archived`, by disuse

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral; `PreToolUse` runs on every tool call | Retirement cannot be evaluated per retrieval |
| L2 | No guaranteed persistent process | **No conservation worker; evaluation is lazy** |
| L3 | Two dependencies, Node ≥ 22 | **No model to judge whether knowledge is still useful** |
| L4 | The hook contract differs per harness | Not relevant here |
| L5 | A hook failure must never block the host | Retirement must never fail a write |
| L6 | Single-developer volumes | Retirement signals must work from tens of observations |
| L7 | Local-first | No cross-user aggregation |

## Invariants this stage must not break

From [`architecture/invariants.md`](../architecture/invariants.md): git is the authority and SQLite is
derived; promotion — and demotion — through deliberate paths, never as a side effect; a reported
success is telemetry.

Add one specific to this stage: **archiving is not deleting.** Deletion stays manual and explicit, in
the audit UI, with a confirmation for canonical memories.

## Start here: confirm the ground before writing code

**This document may be wrong.** It was written against the repository at a point in time, and earlier
stages move code. Run the checks below first. If any result disagrees with what the *Starting state*
section claims, **stop and report the difference** instead of proceeding — a plan that no longer
matches the code is information, not an obstacle to route around.

This is not ceremony. Executing this plan series has produced five cases where it mattered: a stage
described one unreachable handler where there were two plus a routing indirection; a stage instructed a
rule that turned out to be wrong once implemented; a stage named one prompt handler where two exist; a
stage asserted a *Done when* line ("visible in the audit UI") that no code satisfied; and stage 6
specified a guard that, implemented exactly as written, merged two memories that contradicted each
other. The section below is the same check, already run for you.

```bash
# That archived is unreachable. Expect: declared, and never written.
grep -rn "'archived'" src/
grep -rn "lifecycle_state: 'archived'" src/

# The signal to promote from diagnosis to action.
grep -n "dead_inferred" -A 4 src/engine/health/deterioration.js

# The judge of whether retirement was needed at all.
grep -n "cap_saturation" -A 3 src/engine/health/deterioration.js

# The decision this stage must reconcile with, not override.
grep -n "Recency decay" docs/specs/2026-09-10-memory-deterioration-detection.md
```

## Corrections from stage 6

Stage 6 shipped (`6e26e38`, review `56b1e02`). Checked 2026-09-18: **all four *Start here* checks still
return what this document says they should**, and every file and line this document cites is still
accurate — `src/engine/v2/constants.js:3`, `src/store/paths.js:37`, `src/store/schema.sql:35-37`,
`src/engine/retrieve.js:55` (the eight-hit cap) and `:112` (the activation increment),
`src/engine/health/deterioration.js:164-168` (`dead_inferred`). Only `cap_saturation` drifted: it is at
`:213-238`, not `:230`. No code path writes `archived`; the state is still unreachable.

What this document should know before it starts:

**The project this runs on does not have the problem.** The health report of this repository, read
today through `assessDeterioration`, is `healthy` on every indicator: `live_bloat` 17 against a watch
of 80, `dead_inferred` **0**, and `cap_saturation` **skipped** — fewer than the ten retrieval events
the indicator needs to say anything at all. This document's own risk section already names the right
response, and the measurement now confirms it rather than leaving it hypothetical: **ship the mechanism
with thresholds that almost never fire, and do not tune them against a saturation figure that does not
yet exist.** There is no baseline `cap_saturation` to record before the change, and the commit should
say that instead of implying a measurement was taken.

**`src/engine/lifecycle.js` changed, and archiving now interacts with pending revisions.** Stage 6 gave
`admitMemory` a second replacement path: a candidate may name a colliding memory on **another**
`topic_key` in `replaces`, and the promotion is refused with `replacement_changed_review_again` unless
that target is still `active` or `contested`. So **archiving a memory invalidates any pending candidate
proposing to revise it** — correctly, because approving such a candidate would supersede nothing and
leave two memories on one trigger. That is the behaviour to preserve, not a bug to route around, but it
is a new coupling this document predates. A test that archives a memory with a revision pending, and
asserts the revision goes back to review rather than silently promoting, belongs in this stage.

**The threshold correction runs the opposite way to stage 6's.** Stage 6 was told, correctly, not to
add a config key for a threshold that already existed in `DEFAULT_CONFIG.health`. `dead_inferred` is
already there, already project-overridable, with `min_age_days: 14`. Do **not** conclude that this
stage should reuse it: 14 days is when the *indicator warns*, and this document asks for a retirement
threshold deliberately well above it. Those are two concepts, not one duplicated — a warning and an
irreversible-feeling action should not share a number. Add the retirement policy as its own block in
`DEFAULT_HEALTH_THRESHOLDS` (`src/engine/health/deterioration.js:4-11`), which is what
`DEFAULT_CONFIG.health` *is*; **`src/store/paths.js` only re-exports it, so the *Files* list entry for
that file is wrong for the same reason it was wrong in stage 6.**

**`npm run eval` should still be unchanged, and the reason is now stronger than "fresh fixtures".**
The write-path probe promotes through `admitMemory`, which grants `validated`. Authority protects, and
`dead_inferred` only counts `inferred` or `observed`, so no probe memory is reachable by this stage's
criterion whatever its age. Stage 6 added five near-duplicate scenarios to that probe; they are
promoted the same way and are equally out of reach.

**Archived genuinely leaves the retrieval surface** — verified, not assumed. `retrieveMemories` builds
candidates with `lifecycleStates: ['active', 'contested']` (`src/engine/retrieve.js:36`),
`listByTopicLive` filters to the same two (`src/store/sqlite-index.js:194-199`), and the unique index
covers only those two, so an archived memory frees its `topic_key` exactly as this document says. The
git file moves to `archive/` because `archived` is in `ARCHIVE_STATES`.

**Baseline to hold.** `npm test` 247/247, `npm run eval` 24/24 with f1 1.0 and evidence coverage 1.0
(write path: 12 attempts, 10 effective, near-duplicate detection 416.7 per 1000, 0 surviving pairs),
`npm run test:stress` 13/13 at `cold_ms=937 resident_ms=94` on 2000 atoms.

## Starting state

**`archived` is declared and unreachable.** It appears in `LIFECYCLE_STATES`
(`src/engine/v2/constants.js:3`), in `ARCHIVE_STATES` (`src/store/paths.js:37`) and in the health
counts (`src/engine/health/deterioration.js`). Lifecycle states actually written are `candidate`,
`active`, `contested`, `superseded` and `rejected`. **No code path transitions to `archived`.**

**The damage is already measured.** `cap_saturation`
(`src/engine/health/deterioration.js:230`) reports the fraction of the last 50 retrievals that returned
the full eight hits — the cap enforced at `src/engine/retrieve.js:55`. A saturated cap means the budget
is being spent before the best candidates are reached.

**The signal already exists too.** `dead_inferred`
(`src/engine/health/deterioration.js:164-168`) counts memories that are effective, of authority
`inferred` or `observed`, at least 14 days old, and with `activation_count == 0`. That is precisely
"nothing has ever activated this".

`activation_count` is incremented on every delivery at `src/engine/retrieve.js:112`. Since the ranking
work it also feeds the base-level usage factor in `src/engine/ranking.js`, so it is now read as well as
written.

**And there is a decision on record that constrains the design.** The deterioration spec
(`docs/specs/2026-09-10-memory-deterioration-detection.md:26`) rejects recency decay explicitly:

> Not "old". Canonical unused lessons can stay. Recency decay (`-0.005/day`) fights trigger activation
> and is out of scope.

The same spec states the gap this stage closes:

> Retrieve is now O(hits). **Forgetting is still missing.** A bloated live set will not melt retrieve,
> but it will fill the 8-hit cap with noise.

## What changes, and why

### Retire by disuse, not by age

This is the reconciliation with the decision above, and it is the heart of the stage. Age alone says
nothing: a lesson written a year ago about a subsystem nobody touched this quarter is still correct and
will be exactly right the day that subsystem comes up. What justifies retirement is that the trigger
**has had chances to fire and never did**.

So the criterion is the `dead_inferred` conjunction already implemented: effective, low authority, past
a minimum age, and never activated. Promote that indicator from diagnosis to action rather than
inventing a new signal — it is already tuned, already tested, and already visible in the health report.

### Authority protects

A `canonical` or `validated` memory is never retired by this path. A human put it there. If canonical
knowledge is crowding the cap, that is a review decision, not an automatic one. This is what the spec
means by "canonical unused lessons can stay".

### Lazily evaluated, never a worker

L2 forbids depending on a background process. Evaluate on write, or when the health report is
requested — both are moments a process is already running and already holding the lock. Retirement is
not urgent; being a day late costs nothing.

### Reversible, and not deletion

`archived` leaves the retrieval surface and the effective-set uniqueness predicate. The knowledge stays
in git, the audit UI can show it, and a human can bring it back. Deletion remains a separate, manual,
confirmed action.

**Note the index predicate.** The unique index at `src/store/schema.sql:35-37` covers
`lifecycle_state IN ('active','contested')`, so an archived memory frees its `topic_key` — a later
memory can take that key. Verify that is the intended behaviour before shipping; if it is not, the
constraint needs thought, not a workaround.

## Files

- `src/engine/lifecycle.js` — the transition to `archived`
- `src/engine/health/deterioration.js` — expose the retirement candidates the indicator already
  computes
- `src/store/paths.js` — policy thresholds in `DEFAULT_CONFIG`, next to the existing `health` block
- `src/ui/server.js` and `src/ui/public/index.html` — show archived memories and allow restoring one
- `docs/specs/2026-09-10-memory-deterioration-detection.md` — record what stops being detection-only
- `docs/memory/roadmap.md` — Phase 3 item closes; `archived` is reachable
- `docs/architecture/project-cognition.md` — the lifecycle description

## Tests

- A **canonical** memory with `activation_count == 0` and any age is **not** archived. Authority
  protects.
- An `inferred` memory, past the age threshold, never activated, **is** archived.
- An `inferred` memory that was activated once is **not** archived, however old.
- Archiving does not delete: the git file survives and the memory is restorable.
- An archived memory is not returned by `retrieveMemories`.
- Restoring returns it to `active` and it is retrievable again.
- Thresholds come from config and a project can raise them.
- **The write path still succeeds if retirement evaluation throws** (L5).

## Verification

```bash
npm test       # zero failures
npm run eval   # unchanged — the fixtures are fresh and have no usage history
npm run test:stress
```

The real verification is longitudinal and cannot be done in one run: **`cap_saturation` should fall**
on a project with a bloated effective set. Record the current value before the change and check it
after the project has been used for a while. Say plainly in the commit that this is the pending
measurement rather than claiming the benefit up front.

## Risks and what not to do

**This is the highest-risk stage in the plan, and its failure mode is invisible.** Archiving a memory
that was simply waiting for its trigger loses real value, and nothing reports the loss: the agent just
stops getting advice it would have gotten. Every other stage in this plan fails loudly.

Mitigations, all of which are part of the design rather than optional extras:

- Conservative thresholds; start well above the `dead_inferred` defaults and tighten only with evidence.
- Authority protects, so anything a human reviewed is out of reach.
- Reversible, and visible in the audit UI, so the loss is recoverable when noticed.
- `cap_saturation` is the judge of whether retirement was needed at all. If it was never high, this
  stage is solving a problem the project does not have — and the right move is to ship the mechanism
  with thresholds that almost never fire.

Also:

- **Do not add recency decay.** It was rejected on record, for a stated reason, and reintroducing it
  through a side door would be the same failure this plan exists to fix.
- **Do not delete anything.** Archive only.
- **Do not run this from a hook on the hot path.** `PreToolUse` fires on every tool call (L1).

## Done when

- `archived` is reachable, reversible, and visible in the audit UI.
- Authority-protected memories are never retired automatically.
- Thresholds are configurable and documented, with defaults that are deliberately conservative.
- The spec and the roadmap record what changed.
- One commit explaining why retirement is by disuse and not by age, citing the decision it reconciles
  with.

## Depends on / unblocks

Depends on **stage 3** for `cap_saturation` context and the baseline. Independent of stages 4, 5 and 6.
Unblocks nothing in this plan; it is the last stage, and the one most worth deferring if the effective
set is not actually crowded.

## Outcome

Implemented. `npm test` 274/274 (247 before, 27 added), `npm run eval` 24/24 unchanged with f1 1.0 and
evidence coverage 1.0, `npm run test:stress` 13/13. Stress `cold_ms` moved inside its run-to-run
spread (1102–1388 across three runs, against a 937 baseline taken on a quieter machine); no hook module
imports the new code, since `src/hooks/run.js` and `src/hooks/pre-tool.js` reach `retrieve.js` and never
`write.js` or `lifecycle.js`.

### What it does

`retirementCandidates` (`src/engine/health/deterioration.js`) is the `dead_inferred` conjunction with
two tightenings: its own thresholds, and an **opportunity count** — retrievals the project ran after the
memory was written. `archiveMemory` and `restoreMemory` (`src/engine/lifecycle.js`) are the transitions;
`retireByDisuse` drives them and is swept from `proposeMemory`, inside the lock it already holds, with a
`try`/`catch` so a failure cannot fail the write (L5). The audit UI lists `archived` and restores one.

### Where the plan was wrong, and where it was right

- The *Files* list named `src/store/paths.js` for the thresholds. As the plan's own corrections section
  predicted, that file only re-exports `DEFAULT_HEALTH_THRESHOLDS`; the block went in
  `src/engine/health/deterioration.js`, and `healthThresholdsFromConfig` moved there from
  `src/store/create-store.js` so the lifecycle layer and the store merge config the same way.
- The plan's criterion was "never activated, past a minimum age". Implemented exactly as written, that
  retires a memory in a project that has barely retrieved at all — the trigger never fired because
  *nothing* fired. "Its trigger has had chances to fire and never did" is the plan's own sentence, and
  the opportunity count is what makes it true rather than implied.
- The plan did not say what to do with a `contested` memory. Retirement excludes it: a dispute is an
  open human question, and archiving one side would leave the other contested against nothing.
- The stage-6 coupling the plan predicted is real and is tested: archiving a memory sends any pending
  revision naming it back to review with `replacement_changed_review_again`.
- One thing the plan did not anticipate: `upsertAtom`'s `ON CONFLICT` clause never updates `created_at`,
  so backdating a memory to test age only reaches the health snapshot after a rebuild from git. This is
  correct behaviour — git is the authority and `created_at` is immutable identity — but it silently
  makes a naive age test pass for the wrong reason.

### The pending measurement

There is **no baseline `cap_saturation` to compare against**: on this repository the indicator is
`skipped` for want of the ten retrieval events it needs, and `dead_inferred` is 0. Nothing was measured
before the change because there was nothing to measure. The defaults — 90 days *and* 40 of the ≤ 50
retrievals in the snapshot postdating the memory — were chosen to almost never fire, not tuned against
a figure. Whether retirement lowers `cap_saturation` on a project with a genuinely bloated effective set
is longitudinal and still unanswered.

## Review (2026-09-18, after `9f89761`)

One defect, one measurement the commit asserted without taking, and one test-catalog row that stopped
being `later`.

### The sweep retired the memory the same call was revising

`proposeMemory` sets `replaces` on a candidate that revises the live memory on its topic, and then
sweeps. If that live memory was itself disused — `inferred`, never activated, old enough — the sweep
archived it, and `admitMemory` then refused the candidate with `replacement_changed_review_again`. One
call produced a candidate review could never approve, and the reviewer had no way to see why.

This is the stage's own failure mode arriving early: the loss is silent. The candidate looks normal in
the audit UI until someone presses Admit.

The fix is in the selector, not the driver, so the `retirable` list in the health report and the sweep
cannot disagree: a memory named in a pending candidate's `replaces` is excluded. Someone is revising
it, so it is not disused. `loadHealthSnapshot` now reads `replaces` through `json_extract`, which keeps
the snapshot compact and the selector pure.

### The cost claim, measured rather than asserted

The original commit said the sweep is not on the hot path, which is true, but said nothing about what
it costs the write path — and it adds a config read plus a full project atom scan per write. Measured
on the 2000-atom stress corpus, three runs each, against a worktree at `f29e063`:

| | `propose_ms` |
|---|---|
| Before stage 7 | 53, 53, 100 |
| After | 105, 56, 60 |

Same distribution; the sweep is not visible against ordinary run-to-run spread at that size.

### Q13 stopped being `later`

`docs/specs/2026-09-10-memory-quality-and-performance-tests.md` listed "`superseded` / `rejected` /
`archived` never appear in normal retrieve" as a `later` row needing a new retrieve test. The archived
half of it is now a gate test, so the row names the file instead of a plan.

### What the review did not change

- Thresholds. There is still no `cap_saturation` figure to tune against, so they stay where they are.
- The decision to sweep from the write path rather than from the health report. A report that mutates
  is the side effect the invariants forbid; a write is already a deliberate state change.
- `normalizeProposal` was checked for field leakage after `archived_at` and `archived_reason` were
  added to the atom. It is a strict allowlist, so an edit of an archived memory cannot carry them into
  a new candidate.
