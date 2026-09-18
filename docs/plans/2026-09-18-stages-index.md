---
artifact_class: authored
owner_domain: plans
artifact_type: plan-index
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - memory/roadmap.md
do_not_co_load_with: []
---

# Plan 2026-09-18 — Close the gap between what DD promises and what it does

Index of a seven-stage plan. Each stage has its own document and is written to be understood on its
own: read one stage, do that stage.

## Why this plan exists

An alignment audit contrasted every agent-facing surface against `src/` and found the same failure in
both directions. The documentation described a system DD is not — that part is fixed. The code
declares structure it never wired — that is what this plan closes.

What the audit found, and what the stages address:

- Three engine modules imported by nothing but their own tests, which kept them green and made them
  look alive. *Closed by stage 1.*
- Two MCP handlers implemented and never registered, plus a routing indirection that gave a tool, a
  handler of the same name, and the handler that actually ran three different identities.
  *Closed by stage 1.*
- A project-isolation bug that had already fired on a real machine, registering the user's home as a
  DD project. *Closed by stage 2.*
- Enum values no code path emits, a lifecycle state nothing transitions to, relation types nothing
  writes. *Stages 6 and 7; the rest documented as reserved or unplanned.*
- Provenance recorded and ignored, near-duplicates detected and tolerated, the most reliable signal
  available never observed, and no way to measure whether any of it improved. *Stages 3 to 6.*

## Stages

| # | Stage | Status | Closes | Risk |
|---|---|---|---|---|
| 1 | [Cleanup](2026-09-18-stage-1-cleanup.md) | **Done** `f839e93` | Dead modules, unreachable handlers, unused enum value, schema default drift | Low |
| 2 | [Project isolation](2026-09-18-stage-2-project-isolation.md) | **Done** `3308828` | An ancestor capturing the work beneath it; the one red test | Medium |
| 3 | [Measurement](2026-09-18-stage-3-measurement.md) | **Done** `2765ed8` | Abstention has no figure; duplicate rate and evidence coverage unmeasured | Low |
| 4 | [Provenance](2026-09-18-stage-4-provenance.md) | Next | A model guess and an explicit user correction carry identical epistemic force | Medium-high |
| 5 | [User corrections](2026-09-18-stage-5-user-corrections.md) | Waiting on 4 | The highest-reliability signal available is never observed | Medium |
| 6 | [Trigger collisions](2026-09-18-stage-6-trigger-collisions.md) | Ready | Near-duplicate detection runs on every write and is acted on nowhere | Medium |
| 7 | [Forgetting](2026-09-18-stage-7-forgetting.md) | Ready | `archived` is declared and unreachable; the effective set only grows | High |

A stage marked **Done** carries an *Outcome* section recording what it actually did, including where
the plan turned out to be wrong. Read that before assuming the stage body describes the current code.

## Dependency graph

```text
1 cleanup ──┐
            ├──> 3 measurement ──> 4 provenance ──> 5 user corrections
2 isolation ┘                              │
                                           ├──> 6 trigger collisions
                                           └──> 7 forgetting
```

- **1 and 2 are independent of each other** and of everything else. Either can go first; both must
  precede the rest, because stage 1 removes code that would otherwise be maintained for nothing and
  stage 2 fixes a correctness bug the later stages would inherit.
- **3 gates 4 through 7**, and is now done. Stage 4 raises evidence coverage and must not lower it;
  stage 6 is measured by whether duplicate rate moves once near-duplicates are acted upon; every stage
  that changes what gets injected is measured by whether abstention F1 holds. Note that duplicate rate
  catches **exact** equivalence only, so its baseline of 0 understates the problem by construction.
- **5 enriches 4** rather than blocking it: stage 4 defines the reliability ladder and stage 5 adds its
  top source.
- **6 and 7 are independent of each other.**

## Shared rules

Every stage follows these. They are repeated in each document so a stage can be executed without
reading this index.

- **Start by confirming the ground.** Every stage opens with a *Start here* section of checks whose
  expected output is stated. Run them before writing code. If the repository disagrees with the
  document, stop and report it: six errors in this plan were found that way — a stage that described
  one unreachable handler where there were two, a rule that was wrong once implemented, a count of
  abstention scenarios that was off by a third, and three claims in stage 3 about what the store
  already recorded that turned out to be false. Every one of them changed the implementation.
- **Tests first, and check the red is for the right reason.** This work has already produced a test
  that passed vacuously because the operation under test did not trigger the code being measured.
  A green that proves nothing is worse than a red.
- **One commit per stage**, whose message explains the reasoning, not the diff.
- **Baseline is sacred.** After stage 3: `npm test` is **202 tests, 202 passing — zero failures**, and
  `npm run eval` is 24/24, f1 1.0, 2182 estimated tokens, abstention f1 1.0 over 9 scenarios, 0
  duplicates per 1000 write attempts, evidence coverage 1.0. A stage that leaves a failing test is not
  finished. (197 after stage 2, itself down from 213 because stage 1 removed three dead test files;
  stage 3 added five.) The full report is recorded under *Baseline* in
  [the stage 3 document](2026-09-18-stage-3-measurement.md).
- **The replay may not get worse.** A stage that changes ranking runs the replay before and after and
  explains the difference in its commit.
- **Documentation changes in the same commit.** If a stage changes behaviour that `docs/` describes,
  the document is corrected there and then. Re-accumulating that debt is the specific failure this
  plan exists to stop.

## Out of scope

Recorded here so nobody re-derives them as oversights. Each is in `../memory/roadmap.md` under a later
phase.

- **`anti_memory` veto.** `src/hooks/pre-tool.js` always returns `allow`; an anti-memory cannot stop a
  tool call. Blocked by L4: the hook contract differs per harness, and Codex does not even accept
  `decision: 'allow'`. Needs a negotiated-capability design with degradation to a warning.
- **Bounded automatic promotion (SPRT).** Relaxes DD's central safety property. Stage 3 is now done, so
  the measurement precondition is met; it still needs an explicit decision to relax the property, which
  has not been taken.
- **Predominance decay.** Only matters if predominance ever carries weight; it is bounded and is the
  last of four tiers.
- **Full bitemporality.** Git history already answers "what did the system believe on Tuesday".
- **Admission utility score.** Most of its factors are unmeasurable at single-developer volume (L6).
- **Argumentation over the relation graph.** Needs a populated graph; depends on stages 5 and 6.
