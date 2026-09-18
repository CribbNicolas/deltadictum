---
artifact_class: authored
owner_domain: memory
artifact_type: roadmap
stability: draft
last_validated: 2026-09-17
depends_on:
  - architecture/plugin-constraints.md
used_by:
  - memory/behavioral-memory-architecture.md
  - memory/memory-admission-control.md
  - memory/contradiction-supersession.md
  - memory/evaluation-harness.md
do_not_co_load_with: []
---

# Roadmap

Summary: what DD builds next, bounded by what a harness plugin can be.

> This roadmap replaces the former "V1 to V10" plan. That plan targeted a service: V7 assumed dense
> retrieval and reciprocal-rank fusion, V9 assumed federation and RBAC, V10 assumed a hosted AGI-memory
> substrate. None of them are reachable under [the plugin constraints](../architecture/plugin-constraints.md),
> and keeping them as aspiration misled every reader. They are gone rather than deferred.

## Thesis

DD does not store information. It governs which experiences become verifiable changes in future agent
behavior.

Durable memory exists only when it can answer:

- When does this memory apply?
- What should a future agent do differently because this memory exists?
- What evidence justifies preserving and retrieving it?

## Where DD is

Shipped and tested: behavioral admission with a mandatory contract, evidence verification by content
hash, human review as the only promotion path, canonical topic keys with aliases, trigger and scope
based retrieval with a token budget, same-key supersession, explicitly declared contradictions with a
contested lifecycle, deterioration detection, and a local audit UI.

Known gaps, in the order they hurt:

1. **Provenance is recorded and ignored.** `capture_origin` and `evidence_state.provenance` both exist;
   the admission gate reads neither, and confidence is a constant.
2. **Near-duplicate knowledge is detected and tolerated.** `collides_with` is computed on every write
   and acted on nowhere.
3. **Nothing is ever forgotten.** `archived` is a declared lifecycle state that no code path reaches.
4. **Advisory only.** `PreToolUse` always returns `allow`; an `anti_memory` cannot stop anything.
5. **User corrections are not observed.** The observation log records tool failures and validation
   commands; the highest-reliability signal available depends on the model remembering to propose it.
6. **The audit trail is partial.** Supersession writes no log row at all, `detection_source` is always
   `explicit`, and `actor_ref` is never populated. The log itself is now retained as audit rather
   than pruned as telemetry.

## Phase 1 — Make the existing signals honest

Wire what is already written, add no dependency, keep the human in the write path.

Done:

- ✅ Never inject both sides of a contradiction in one pack.
- ✅ Suppress near-duplicate advice inside a pack.
- ✅ Use recorded frequency and age to separate live from dead knowledge.
- ✅ Require unreviewed authorities to clear a higher activation bar than reviewed ones, because a
  wrong injection costs more than a missed one.
- ✅ Retain the contradiction log as audit instead of pruning it as telemetry.
- ✅ Unify the entrenchment order. One authority ladder now backs both the retrieval weight and the
  resolution rank, so they cannot disagree about which authority outranks which.
- ✅ Give contradiction resolution a declared precedence policy — evidence, then recency, then
  authority, then track record — surfaced to the reviewer with the tier that decided it, and never as
  a decision. The evidence signal is derived from verified artifact coverage, and the winner of a
  human resolution records a bounded track record.

Remaining:

- Act on `collides_with` instead of only reporting it.
- Rank knowledge by source reliability, with a hard cap per source, so a model claim can never reach
  the standing of a verified artifact or an explicit user correction.

## Phase 2 — Fix what produces the knowledge

Phase 1 filters the output. Phase 2 improves the input, which is the larger win.

- Observe explicit user corrections as a first-class, high-reliability signal.
- Generalise repeated corrections into one scoped rule instead of accumulating near-duplicates.
- Route admission to add, ignore or merge rather than only accept or reject.
- Order the review queue by expected value, since human review time is the scarce resource.
- Distinguish a one-line evidence change from a rewritten file, so revision conditions close without a
  human.

## Phase 3 — Behavior beyond advice

- A negotiated veto path for anti-memories, degrading to a warning on harnesses that cannot veto.
- Retire knowledge that nothing activates, by disuse rather than by age.
- Bounded automatic promotion, from inferred to validated only, on artifact-verified evidence only,
  reversible and logged. This is the only item that relaxes a current safety property and it does not
  begin without an explicit decision to relax it.

## Phase boundary rule

Each phase must be implementable without pretending a later phase exists. Naming a later concept is
fine; depending on one is not.

## Success criteria

The program succeeds when it meets all five:

1. **Written-memory reliability** — less contamination, higher evidence coverage, lower unresolved-contradiction rate.
2. **Measured improvement** — gains on the replay harness and on internal task replay, not just final
   answer quality. Baseline of 2026-09-18 (`npm run eval`): retrieval F1 1.0 over 24 scenarios,
   abstention F1 1.0 over the 9 that expect nothing, 0 duplicates per 1000 write attempts,
   evidence coverage 1.0, 81% fewer tokens than static instructions. Recorded in
   [`plans/2026-09-18-stage-3-measurement.md`](../plans/2026-09-18-stage-3-measurement.md).
3. **Operational efficiency** — fewer injected tokens, lower hot-path latency, higher signal per query.
4. **Security** — resistance to poisoning and to cross-project leakage.
5. **Human governance** — auditable, editable, understood by the team; never an uncontestable black box.

## Open questions

- How much compression is safe before evidence is destroyed.
- How to measure whether a stored memory is *true* and *useful*, not merely retrievable.
- 2025–2026 sources on agent memory are largely preprints with self-reported benchmarks and no
  standardised leaderboard; treat them as signals, not settled fact.
