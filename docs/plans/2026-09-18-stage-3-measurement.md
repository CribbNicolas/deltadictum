---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - memory/evaluation-harness.md
  - plans/2026-09-18-stages-index.md
do_not_co_load_with: []
---

# Stage 3 — Measurement: give the next four stages something to prove

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral Node processes; `PreToolUse` runs on every tool call | Nothing warm on the hot path |
| L2 | No guaranteed persistent process | No required background worker |
| L3 | Two dependencies, Node ≥ 22 | **No embeddings, no ML libraries** |
| L4 | The hook contract differs per harness | A veto is not portable |
| L5 | A hook failure must never block the host | Every gate needs a failure direction |
| L6 | Single-developer volumes (90 days / 2000 telemetry rows) | **No online learning, and small samples** |
| L7 | Local-first | No cross-user aggregation |

L6 is the one that shapes this stage: the numbers here come from a handful of authored scenarios and a
single developer's telemetry. They are regression signals, not statistics.

## Invariants this stage must not break

From [`architecture/invariants.md`](../architecture/invariants.md): model output never mutates state; a
reported success is telemetry and never raises authority or confidence; evidence establishes integrity,
never entailment.

This stage adds instrumentation only. It must not change a single retrieval decision.

## Start here: confirm the ground before writing code

**This document may be wrong.** It was written against the repository at a point in time, and earlier
stages move code. Run the checks below first. If any result disagrees with what the *Starting state*
section claims, **stop and report the difference** instead of proceeding — a plan that no longer
matches the code is information, not an obstacle to route around.

This is not ceremony. Executing this plan has already produced two cases where it mattered: a stage
described one unreachable handler where there were two plus a routing indirection, and a stage
instructed a rule that turned out to be wrong once implemented.

```bash
# Current report shape. Expect: exact, precision, recall, f1, estimated_tokens —
# and no abstention, duplicate or coverage figure.
npm run eval

# The abstention data that already exists. Expect: 9 of 24.
grep -c "expected: \[\]" src/eval/cases.js
grep -c "^  { id:" src/eval/cases.js

# Where the duplicate signal comes from. Expect: an ignore decision with reason
# equivalent_knowledge_exists, and logAdmission recording decisions.
grep -n "equivalent_knowledge_exists" src/engine/write.js
grep -n "logAdmission" src/engine/write.js src/store/create-store.js

# Where coverage comes from. Expect: verified_count on evidence_state.
grep -n "verified_count" src/engine/evidence.js
```

## Starting state

`src/eval/replay.js` seeds a real store with the seven fixtures in `src/eval/cases.js` and runs the
real `retrieveMemories` over 24 scenarios. It reports exact-case count, precision, recall, F1, estimated
token cost against a static-instruction baseline, and per-case elapsed time. CI fails below
`f1 < 0.9 || exact < 90%`.

Current output, and the baseline this stage must preserve:

```json
{ "cases": 24, "exact": 24, "precision": 1, "recall": 1, "f1": 1,
  "estimated_tokens": { "dd": 2182, "static_instructions": 11472, "reduction_vs_static": 0.8098 } }
```

What is missing, and what `docs/memory/evaluation-harness.md` already specifies but nothing implements:

**Abstention has no figure of its own, although the data is already there.** Nine of the 24 scenarios
expect `[]` — `payment-other-component`, `migration-unapplied`, `clock-wrong-scope`,
`webhook-other-provider`, `retired-advice`, and the four `unrelated-*` cases. That is more than a
third of the suite, measured and then discarded into the same precision and recall as everything else. They currently fold into
the same precision and recall as everything else. Abstaining correctly is half of what DD is for, and
it is invisible.

**Duplicate rate is not reported**, although `memory_admission_decisions` already records what it needs:
`proposeMemory` logs `write` on admission and returns `ignore` with reason
`equivalent_knowledge_exists` when `sameKnowledge` matches (`src/engine/write.js:46-50`).

**Evidence coverage is not reported.** `evidence_state.verified_count` exists on every atom
(`src/engine/evidence.js:17-43`) and, since the entrenchment work, is the primary tier of contested
resolution. Stage 4 will move it, so it needs a baseline now.

## What changes, and why

Three numbers get added to the replay report. None of them changes behaviour.

### 1. Abstention as its own figure

Report precision, recall and F1 of the **decision to abstain**, separately from retrieval F1. Treat
"returned nothing" as the positive class over the 24 scenarios: the nine that expect `[]` are the
positives.

This matters more than it looks. Retrieval F1 can stay at 1.0 while abstention silently degrades, and
every later stage in this plan changes what gets injected. Without this number, a stage that starts
injecting noise on unrelated tasks would look like a success.

### 2. Duplicate rate per 1000 write attempts

`ignore` decisions with reason `equivalent_knowledge_exists`, over total write attempts. Read from
`memory_admission_decisions`.

Note the honest limitation: today this only catches **exact** equivalence, because `sameKnowledge`
compares thirteen fields as serialised JSON. Paraphrases do not register as duplicates at all, so the
baseline will understate the problem. That is the point — stage 6 is measured by whether this number
moves once near-duplicates are actually acted upon.

### 3. Evidence coverage

Proportion of effective memories carrying at least one artifact with `status: 'verified'`. Stage 4 is
expected to raise it, and must not lower it.

### Fix the metric before measuring

The research behind this plan found discrepancies of tens of points between strict token-F1 and
LLM-as-judge scoring **on the same system**. This harness reports strict set equality against authored
ground truth. Say so in `docs/memory/evaluation-harness.md`, so a future comparison against a published
benchmark number is not made as if they were the same measurement.

Also worth recording there, because it bounds every claim made from this harness: the fixtures are
authored alongside the engine and its vocabulary. This measures conditional retrieval and context cost.
It does not measure model task success, code quality, or whether a real model would have found the same
guidance by reading the repository.

## Files

- `src/eval/replay.js` — the three metrics and the report shape
- `src/eval/cases.js` — only if the abstention set needs more scenarios to be meaningful; prefer not to
  change the existing 24, because the baseline is defined over them
- `docs/memory/evaluation-harness.md` — mark implemented what becomes implemented; state the metric
  definition and its limits
- `docs/memory/roadmap.md` — success criterion 2 can now cite real figures

## Tests

- The abstention figure is computed from the scenarios that expect `[]`, and a deliberately broken
  retrieval that injects on every scenario drives abstention recall to zero. **Assert the failure
  direction**, not only the happy path — a metric that cannot go down measures nothing.
- Duplicate rate is zero on a store with no duplicate proposals, and non-zero after the same proposal
  is submitted twice.
- Evidence coverage is 1 for a fixture set whose references all resolve, and drops when a reference is
  removed from disk.
- The existing CI gate still fires: `f1 < 0.9` or `exact < 90%` exits non-zero.

## Verification

```bash
npm run eval
```

Then **paste the full report into this document** under a "Baseline" heading with the date. Every later
stage compares against it, so it has to live somewhere durable rather than in a terminal scrollback.

```bash
npm test      # zero failures — stage 2 has already cleaned the suite
```

## Risks and what not to do

- **Do not relax the CI gate** to accommodate a new metric. If abstention F1 deserves a gate, add one;
  do not weaken the existing one.
- **Do not change the 24 scenarios** unless the abstention set is genuinely too small to be meaningful.
  Changing them invalidates the baseline the whole plan is measured against, and the change must then
  be called out explicitly.
- **Do not report a metric this harness cannot support.** Latency percentiles belong in
  `npm run test:stress`, where the hot path is actually exercised; a per-case timing from the replay is
  not a p95.

## Done when

- `npm run eval` reports abstention precision/recall/F1, duplicate rate per 1000 writes, and evidence
  coverage, alongside the existing figures.
- The baseline is recorded in this document with its date.
- `docs/memory/evaluation-harness.md` states what the metric is and what it cannot tell you.
- One commit explaining why abstention deserved its own figure.

## Depends on / unblocks

Depends on stages 1 and 2 only for a clean baseline — the suite must be green before a baseline means
anything. **Gates stages 4, 5, 6 and 7**: without these numbers, each of them is an opinion.

## Baseline

_To be filled in when this stage runs. Record the complete `npm run eval` output and the date._
