---
artifact_class: authored
owner_domain: memory
artifact_type: roadmap
stability: draft
last_validated: 2026-09-18
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

1. ~~**Provenance is recorded and ignored.**~~ **Closed.** `src/engine/reliability.js` declares an
   ordinal ladder capping attainable confidence per source; the gate reports the ceiling and
   `admitMemory` stamps it from the evidence verified during review. `confidence` now varies by source
   instead of being a constant.
2. ~~**Near-duplicate knowledge is detected and tolerated.**~~ **Closed.** `collides_with` is now
   computed before the atom is written and routes the admission decision. A restatement of an
   effective memory with the same scope and the same direction is proposed as an `update` naming it in
   `replaces`; a disjoint scope stays separate knowledge; anything ambiguous is written as a candidate
   flagged `suspected_duplicate_pair`, so the reviewer sees the two together. Nothing merges without
   review.
3. ~~**Nothing is ever forgotten.**~~ **Closed.** `archived` is reachable: `archiveMemory` writes it and
   `retireByDisuse` drives it from the `dead_inferred` conjunction plus an opportunity count, swept
   lazily on the write path. Authority protects, contested is excluded, and `restoreMemory` brings a
   memory back through the audit UI. Archiving is not deletion; deletion stays manual and confirmed.
4. **Advisory only.** `PreToolUse` always returns `allow`; an `anti_memory` cannot stop anything.
5. ~~**User corrections are not observed.**~~ **Closed.** `observationFromPrompt` in
   `src/hooks/observe.js` detects corrective language lexically on `UserPromptSubmit` and records it as
   a `user_correction` observation, referenceable by ID at proposal time. The top rung of the
   reliability ladder now has a producer.
6. ~~**A data-directory rename orphans telemetry, silently.**~~ **Closed.** When `openStore` creates a new
   index, `adoptHistory` (`src/store/adopt.js`) copies this project's rows from every known earlier
   location — `~/.supermem`, `~/.dd`, `~/.dd-data`, the plugin-host bases, `.dd/local` — by primary key,
   and records what it adopted in `index_meta.adopted_history`. Sources are read, never removed. The
   original finding: `dataBase` in `src/project.js` has moved
   twice (`~/.supermem`, `~/.dd`, `~/.dd-data`). Atoms return from git on any rebuild, so a store with a
   fresh index looks complete; retrieval events, admission decisions, observations and the contradiction
   log live only in SQLite under the old path and are abandoned with no migration and no warning. Found
   2026-09-19 with three stores for this project and its telemetry split three ways, which left
   `cap_saturation` reporting `skipped` for want of data that existed. The rows were merged by hand;
   nothing in the code does this.
7. ~~**The hook bridge answers with another process's build.**~~ **Closed.** The audit UI stamps hook
   replies with `x-dd-build`, a hash of its source root, and `x-dd-version`; the hook takes a reply only
   from its own tree or the same package version (installs of one version share a resident since
   2026-09-24); the UI returns `409 build_stale` once its source tree has changed since it started
   (`src/hooks/build.js`).
   The original finding: `callRunningStore` forwards
   `session-start`, `prompt` and `pre-tool` to any audit UI recorded in `.dd/ui.json`, and that process
   may have been started from an older DD. Its store receives the telemetry and its code shapes the
   response, while the hook exits 0 either way. Nothing distinguishes a bridged reply from a local one.
8. **The audit trail is partial.** Supersession writes no log row at all, `detection_source` is always
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
- ✅ Rank knowledge by source reliability, with a hard cap per source, so a model claim can never reach
  the standing of a verified artifact or an explicit user correction. One declared ordinal ladder,
  applied at admission rather than at proposal, because candidates are never retrieved. Human review
  stays above it: a reviewer granting `canonical` is not clamped.
- ✅ Give contradiction resolution a declared precedence policy — evidence, then recency, then
  authority, then track record — surfaced to the reviewer with the tier that decided it, and never as
  a decision. The evidence signal is derived from verified artifact coverage, and the winner of a
  human resolution records a bounded track record.

Done (continued):

- ✅ Act on `collides_with` instead of only reporting it. The routing is lexical — scope equality and
  preventive polarity — because there is no embedding budget (L3) and no background judge (L2).
  Ambiguity escalates to the reviewer rather than resolving itself, since a duplicate is recoverable
  and deleted knowledge is not.

## Phase 2 — Fix what produces the knowledge

Phase 1 filters the output. Phase 2 improves the input, which is the larger win.

Done:

- ✅ Observe explicit user corrections as a first-class, high-reliability signal. A deterministic
  English/Spanish detector runs inline on `UserPromptSubmit` and writes a `user_correction`
  observation; the capture prompt surfaces it alongside host evidence. Detection promotes nothing, so
  the cheap error is a false positive and the expensive one is a silent miss.

Remaining:

- Generalise repeated corrections into one scoped rule instead of accumulating near-duplicates.
- Route admission to add, ignore or merge rather than only accept or reject.
- Order the review queue by expected value, since human review time is the scarce resource.
- Distinguish a one-line evidence change from a rewritten file, so revision conditions close without a
  human.

## Phase 3 — Behavior beyond advice

- A negotiated veto path for anti-memories, degrading to a warning on harnesses that cannot veto.
- ✅ Retire knowledge that nothing activates, by disuse rather than by age. Shipped 2026-09-18 with
  deliberately conservative defaults (90 days *and* 40 retrievals that postdate the memory), because
  the repository it shipped on had `dead_inferred` 0 and `cap_saturation` skipped — the mechanism is
  in place. Baseline measured 2026-09-19 once orphaned telemetry was recovered: `cap_saturation` 0.000
  over 50 retrievals, 43 of them abstentions and none returning more than one memory. The cap has never
  been approached here, so whether retirement lowers it stays a question for a crowded project.
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
   evidence coverage 1.0, 81% fewer tokens than static instructions.
3. **Operational efficiency** — fewer injected tokens, lower hot-path latency, higher signal per query.
4. **Security** — resistance to poisoning and to cross-project leakage.
5. **Human governance** — auditable, editable, understood by the team; never an uncontestable black box.

## Open questions

- How much compression is safe before evidence is destroyed.
- How to measure whether a stored memory is *true* and *useful*, not merely retrievable.
- 2025–2026 sources on agent memory are largely preprints with self-reported benchmarks and no
  standardised leaderboard; treat them as signals, not settled fact.
