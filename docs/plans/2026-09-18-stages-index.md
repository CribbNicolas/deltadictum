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

Concretely, the repository currently contains:

- Three engine modules imported by nothing but their own tests, which keeps them green and makes them
  look alive.
- An MCP handler that is implemented and never registered, so no caller can reach it.
- Enum values no code path emits, a lifecycle state nothing transitions to, relation types nothing
  writes, and a column nothing increments.
- A project-isolation bug that already fired on a real machine.

## Stages

| # | Stage | Closes | Risk |
|---|---|---|---|
| 1 | [Cleanup](2026-09-18-stage-1-cleanup.md) | Dead modules, unreachable handler, unused enum value, schema default drift | Low |
| 2 | [Project isolation](2026-09-18-stage-2-project-isolation.md) | `findRepoRoot` resolving to the home directory; the one red test | Medium |
| 3 | [Measurement](2026-09-18-stage-3-measurement.md) | Abstention has no figure; duplicate rate and evidence coverage unmeasured | Low |
| 4 | [Provenance](2026-09-18-stage-4-provenance.md) | A model guess and an explicit user correction carry identical epistemic force | Medium-high |
| 5 | [User corrections](2026-09-18-stage-5-user-corrections.md) | The highest-reliability signal available is never observed | Medium |
| 6 | [Trigger collisions](2026-09-18-stage-6-trigger-collisions.md) | Near-duplicate detection runs on every write and is acted on nowhere | Medium |
| 7 | [Forgetting](2026-09-18-stage-7-forgetting.md) | `archived` is declared and unreachable; the effective set only grows | High |

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
- **3 gates 4 through 7.** Without abstention F1, duplicate rate and evidence coverage there is no way
  to show any later stage helped. Stage 3 captures the baseline every later stage is compared against.
- **5 enriches 4** rather than blocking it: stage 4 defines the reliability ladder and stage 5 adds its
  top source.
- **6 and 7 are independent of each other.**

## Shared rules

Every stage follows these. They are repeated in each document so a stage can be executed without
reading this index.

- **Tests first, and check the red is for the right reason.** This work has already produced a test
  that passed vacuously because the operation under test did not trigger the code being measured.
  A green that proves nothing is worse than a red.
- **One commit per stage**, whose message explains the reasoning, not the diff.
- **Baseline is sacred.** `npm test` is 213 tests with 212 passing; `npm run eval` is 24/24, f1 1.0,
  2182 estimated tokens. The single permitted failure is `tests/store/transactions.test.js` **until
  stage 2**, which fixes it. After that, zero failures.
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
- **Bounded automatic promotion (SPRT).** Relaxes DD's central safety property. Needs stage 3 first and
  an explicit decision to relax it.
- **Predominance decay.** Only matters if predominance ever carries weight; it is bounded and is the
  last of four tiers.
- **Full bitemporality.** Git history already answers "what did the system believe on Tuesday".
- **Admission utility score.** Most of its factors are unmeasurable at single-developer volume (L6).
- **Argumentation over the relation graph.** Needs a populated graph; depends on stages 5 and 6.
