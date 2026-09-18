---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - specs/2026-09-10-memory-deterioration-detection.md
  - plans/2026-09-18-stage-3-measurement.md
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
