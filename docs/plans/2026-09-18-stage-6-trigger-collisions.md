---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: implemented
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - memory/memory-admission-control.md
  - plans/2026-09-18-stage-3-measurement.md
  - plans/2026-09-18-stage-5-user-corrections.md
do_not_co_load_with: []
---

# Stage 6 — Act on trigger collisions

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral; `PreToolUse` runs on every tool call | Write-path cost is amortised, but keep it bounded |
| L2 | No guaranteed persistent process | **No consolidation worker; the decision is inline** |
| L3 | Two dependencies, Node ≥ 22 | **No embeddings — similarity is lexical** |
| L4 | The hook contract differs per harness | Not relevant here |
| L5 | A hook failure must never block the host | A collision check must not fail a write |
| L6 | Single-developer volumes | **Human review time is the scarce resource, not API cost** |
| L7 | Local-first | No cross-user aggregation |

L6 reframes the objective. Published work on this routing optimises API spend; here the thing being
conserved is the reviewer's attention.

## Invariants this stage must not break

From [`architecture/invariants.md`](../architecture/invariants.md): model output never mutates state;
promotion only through local human review; one effective memory per `topic_key`; **the effective memory
never changes without review**.

Merging is the risky operation in this stage. Nothing here may alter an effective memory.

## Start here: confirm the ground before writing code

**This document may be wrong.** It was written against the repository at a point in time, and earlier
stages move code. Run the checks below first. If any result disagrees with what the *Starting state*
section claims, **stop and report the difference** instead of proceeding — a plan that no longer
matches the code is information, not an obstacle to route around.

This is not ceremony. Executing this plan series has produced four cases where it mattered: a stage
described one unreachable handler where there were two plus a routing indirection; a stage instructed a
rule that turned out to be wrong once implemented; a stage named one prompt handler where two exist;
and a stage asserted a *Done when* line ("visible in the audit UI") that no code satisfied. The section
below is the same check, already run for you.

```bash
# The detector that already runs. Expect: a jaccard >= 0.5 filter, returned and unused.
grep -n "collides_with" src/engine/write.js src/mcp/tools.js src/engine/v2/admission.js

# Why paraphrases escape. Expect: exact JSON comparison over MATERIAL_FIELDS.
grep -n "sameKnowledge" -A 5 src/engine/contract.js

# The decision to emit. Expect: update declared and never emitted.
grep -n "ADMISSION_DECISIONS" src/engine/v2/constants.js
grep -rn "decision: 'update'" src/

# The baseline to beat. Expect: a duplicate rate, from stage 3.
npm run eval
```

## Corrections from stage 5

Stage 5 shipped (`e5b8c6f`, review `b884d31`). Checked 2026-09-18: **all four *Start here* checks still
return what this document says they should.** Only line numbers drifted — `src/engine/write.js:62-65`,
`src/engine/contract.js:95-99`, `src/engine/v2/constants.js:7`, and the health indicator at
`src/engine/health/deterioration.js:6` and `:138-160`. What this document gets wrong:

**The threshold is already in config, and the *Files* list points at the wrong file.**
`DEFAULT_CONFIG.health` *is* `DEFAULT_HEALTH_THRESHOLDS` (`src/store/paths.js:80`), which already
contains `trigger_collision: { jaccard: 0.5, ... }` and is already project-overridable. Adding a key
next to `vpt_threshold` would create a second threshold for one concept — the drift this plan's own
risks section forbids for the similarity function, for the same reason. Read
`config.health.trigger_collision.jaccard` and delete the literal `0.5` in `write.js`, which is
currently a second copy of that number. **Remove `src/store/paths.js` from the *Files* list.**

**The collision is computed after the atom is already written.** `src/engine/write.js:60` calls
`store.putAtom(payload)`, and only then loads peers and computes `collides_with`. A decision cannot be
routed on a value produced after the write it is supposed to route. Moving the computation above the
`putAtom` call is the first change this stage makes, and it is structural, not cosmetic.

**The comparison does not see candidates.** `peers` is `lifecycleStates: ['active', 'contested']`, so a
near-duplicate sitting in the review queue is invisible. This matters directly for the stage 5 feed
below: repeated corrections arrive as candidates, and two near-identical *candidates* are exactly the
pair a reviewer should see together. Decide whether candidates join the comparison; if they do, the
scope guard and the "when in doubt, create the candidate" rule apply unchanged.

**The acceptance criterion cannot be met as written.** `npm run eval` currently reports
`write_attempts: 7, duplicates: 0, duplicate_rate_per_1000: 0`. A rate of zero cannot "measurably
fall". The replay corpus contains no near-duplicate scenario, so the metric judges nothing today. Add
paraphrase and scope-mismatch scenarios to the corpus *before* changing the routing, so the number
means something in both directions — this is the same trap stage 3 named: a green that proves nothing.

**Stage 5 landed, and its feed is real.** `user_correction` observations now exist
(`observationFromPrompt` in `src/hooks/observe.js`), and the audit UI lists recorded evidence read-only.
The "repeated corrections on one topic" case this stage benefits from is reachable rather than
hypothetical.

**Baseline to hold.** `npm test` 239/239, `npm run eval` 24/24 with f1 1.0 and evidence coverage 1.0,
`npm run test:stress` 12/12 at `cold_ms=1124 resident_ms=110` on 2000 atoms.

## Starting state

**The detector already runs on every write.** `src/engine/write.js:62-64`:

```js
const collides_with = peers.filter(a => a.id !== atom.id).map(peer => ({ id: peer.id, topic_key: peer.topic_key,
  jaccard: Math.round(triggerJaccard(peer.trigger, atom.trigger) * 1000) / 1000 })).filter(p => p.jaccard >= 0.5).slice(0, 20);
```

It compares the proposal's trigger against every effective memory and keeps pairs at Jaccard ≥ 0.5.
The result is returned to the caller and surfaced over MCP (`src/mcp/tools.js:16`).

**And no engine decision uses it.** It informs the model and is then dropped. The same computation runs
a second time as a health indicator, `trigger_collision` in `src/engine/health/deterioration.js:136-154`,
which also only reports.

**Meanwhile deduplication is exact.** `sameKnowledge` (`src/engine/contract.js:95-99`) compares the
thirteen `MATERIAL_FIELDS` as serialised JSON. A paraphrase, a reordered list, or one extra word is a
new candidate. So the write path can detect near-duplicates and chooses not to, while the mechanism
that does block duplicates cannot see them.

**One decision is declared and never emitted.** `ADMISSION_DECISIONS` (`src/engine/v2/constants.js:7`)
includes `update`. Stage 1 deliberately kept it for this stage.

## What changes, and why

Route the admission decision on the collision result instead of discarding it.

| Situation | Decision | Effect |
|---|---|---|
| No meaningful collision | `write` | Candidate as today |
| Exactly equivalent | `ignore` | Existing memory returned, as today |
| Strong collision, same scope | `update` | Proposed as a revision of the colliding memory rather than a sibling |
| Ambiguous collision | escalate | Candidate, **flagged as a suspected pair for review** |

This is the ADD / NOOP / MERGE routing idea from SAGE
([arXiv:2605.30711](https://arxiv.org/abs/2605.30711)) without its density estimator, which needs
embeddings (L3). The lexical Jaccard already computed is the substitute, and it is enough for the case
that actually hurts: the same lesson restated.

**Ambiguity escalates to a human rather than resolving itself.** There is no background judge to
arbitrate (L2) and no semantic similarity to lean on (L3). The reviewer is already in the loop and is
the right arbiter; the improvement is that they see the suspected pair together instead of finding two
near-identical memories weeks later.

**Scope is what distinguishes a duplicate from a distinct memory.** Two memories can share a trigger
and apply to different files, components or operations — the `applies_to` gate in
`src/engine/activation.js:36-65` treats them as different knowledge, and so must this stage. A trigger
match with a scope mismatch is not a duplicate.

**The threshold is configurable with a justified default.** 0.5 is the value already in use for the
report and the health indicator; reuse it rather than introducing a second constant. It is already in
config, at `config.health.trigger_collision.jaccard` — read it there. See *Corrections from stage 5*.

## Files

- `src/engine/write.js` — carry the collision into the decision instead of only returning it
- `src/engine/v2/admission.js` — the routing
- `src/mcp/tools.js` — surface the decision so the agent understands why a proposal became a revision
- ~~`src/store/paths.js`~~ — nothing to do; the threshold is already in `DEFAULT_CONFIG.health`, see
  *Corrections from stage 5* above
- `src/eval/` — near-duplicate scenarios, so the acceptance metric is not judging an empty set
- `docs/memory/memory-admission-control.md` — remove the "Not implemented" note on collisions, and the
  one on `update` never being emitted
- `docs/memory/roadmap.md` — gap closes

## Tests

- A paraphrase of an existing memory with a near-identical trigger does **not** silently create a
  second candidate.
- A similar trigger with a **different scope** does create a separate memory. This is the test that
  stops the stage from destroying real knowledge.
- An ambiguous collision produces a candidate flagged as a suspected pair, and **does not modify the
  effective memory**.
- The threshold is read from config and a project can change it.
- `update` is emitted and appears in `memory_admission_decisions`.
- Write-path latency stays bounded as the effective set grows — the comparison is over all effective
  memories, so assert the cost at the scale `tests/stress/` already exercises.

## Verification

```bash
npm run eval   # duplicate rate, from the Stage 3 baseline, must measurably fall
npm test       # zero failures
npm run test:stress
```

**The duplicate rate is the acceptance criterion.** If it does not move, this stage did not work, and
the honest response is to say so in the commit rather than to declare it done because the code shipped.

Note the baseline's known bias: stage 3's duplicate rate only counts exact equivalence, so it
understates the problem. Expect the measured rate to *rise* first as near-duplicates start being
detected, then fall as they stop being created. Distinguish those two in the report.

## Risks and what not to do

- **The expensive error is the false positive**: merging two memories that only resembled each other in
  their trigger. Scope is the guard, and ambiguity escalates rather than merging. When in doubt, create
  the candidate — a duplicate is recoverable, deleted knowledge is not.
- **Do not merge content automatically.** `update` proposes a revision that a human approves. Nothing
  in this stage may change an effective memory.
- **Do not raise the threshold to make the number look better.** The metric exists to be honest.
- **Do not add a second similarity implementation.** `triggerJaccard` is already exported from
  `src/engine/health/deterioration.js` and already used by `src/engine/write.js` and
  `src/engine/ranking.js`.

## Done when

- The collision result drives the admission decision.
- `update` is emitted and recorded.
- A scope-differing trigger match still produces separate knowledge.
- The duplicate rate moved, and the commit reports what it did with the direction explained.
- One commit explaining why ambiguity escalates instead of merging.

## Depends on / unblocks

Depends on **stage 3** for the duplicate-rate baseline that judges it. Benefits from **stage 5**:
repeated corrections on one topic are the near-duplicates this stage catches. Independent of stage 7.

## Outcome

Implemented. `npm test` 246/246, `npm run eval` 24/24 with f1 1.0 and evidence coverage 1.0,
`npm run test:stress` 13/13 at `cold_ms=937 resident_ms=94` on 2000 atoms.

### What the acceptance number did

The plan's criterion — "the duplicate rate must measurably fall" — could not be read off the existing
figure, and the plan said so: `duplicate_rate_per_1000` counts `ignore` decisions, which only fire on
exact equivalence. It was 0 before and it is 0 after. That is not the stage failing; it is the metric
measuring detection of a case the corpus never contained.

So the corpus gained five near-duplicate scenarios (`NEAR_DUPLICATES` in `src/eval/replay.js`) and the
report gained two figures that move in opposite directions, exactly as the plan predicted:

| | Routing off | Routing on |
|---|---|---|
| `near_duplicate_detection_rate_per_1000` | 0 | 416.7 |
| `near_duplicate_pairs_surviving` | **2** | **0** |
| `effective_memories` | 12 | 10 |

Both columns are the same corpus and the same 12 write attempts; "routing off" is the identical build
with `trigger_collision.jaccard` above 1, so nothing collides. Detection rose from nothing, and the
number that matters — near-identical memories that reached the effective set anyway — fell to zero.
The surviving-pairs measurement threshold is pinned at 0.5 in the eval rather than read from config,
so raising a project's threshold cannot improve the score it is being judged by.

Retrieval is untouched: 24/24 exact, f1 1.0, 2182 estimated tokens, abstention f1 1.0.

### Where the plan was wrong, or incomplete

**A revision must not reverse the memory it revises.** The plan's guard was scope alone. Scope alone
merges opposites: three existing tests build an *opposing* memory that shares a trigger and a scope in
order to contest it, and the first implementation superseded one with the other, deleting knowledge —
the plan's own named expensive error, reached by following the plan. `agreesInDirection` was added:
same `memory_type`, same polarity under the preventive vocabulary the anti-memory gate already uses.
An opposing collision escalates as a suspected pair; contradiction remains `declareContradiction`'s job.

**`replaces` was coupled to `topic_key`, so `update` would have been decorative.** `admitMemory`
resolved the replacement target by looking up the live memory *for the candidate's own topic*. A
cross-topic `replaces` would have been silently dropped at approval, leaving both memories effective —
the decision would have been emitted and recorded while changing nothing. `src/engine/lifecycle.js`
now resolves the target by id and re-checks that it is still effective at review time. That file was
not in the plan's *Files* list.

**Three test fixtures built near-duplicates on purpose.** They constructed four, twelve and two
memories that differed only in `topic_key` while standing in for distinct knowledge. They are now
genuinely distinct. This is the stage working, not a regression, but it is worth recording that the
repository's own fixtures contained the pattern this stage exists to stop.

**Candidates join the comparison, but are never a revision target.** The plan left the decision open.
They are compared, because two near-identical candidates are the pair a reviewer should see together;
they cannot be replaced, because a candidate is not effective and superseding it would mean nothing.

**The eval probe reviewed in a batch.** `runWritePathProbe` proposed everything and only then admitted
it, so every peer was still a candidate when the next proposal arrived and no collision could route.
It now reviews each proposal before the next, which is the order real use produces.

**The threshold and the *Files* correction from stage 5 both held.** `config.health.trigger_collision.jaccard`
is read in `src/engine/write.js`; the literal `0.5` is gone; `src/store/paths.js` was not touched.

### Not done

The audit UI shows a suspected pair as a warning on the candidate, naming the ids. It does not yet
render the two memories side by side, which is what "see the pair together" should eventually mean.
