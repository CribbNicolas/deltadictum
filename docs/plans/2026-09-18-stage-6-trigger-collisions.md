---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - memory/memory-admission-control.md
  - plans/2026-09-18-stage-3-measurement.md
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

## Starting state

**The detector already runs on every write.** `src/engine/write.js:52-54`:

```js
const collides_with = peers.filter(a => a.id !== atom.id).map(peer => ({ id: peer.id, topic_key: peer.topic_key,
  jaccard: Math.round(triggerJaccard(peer.trigger, atom.trigger) * 1000) / 1000 })).filter(p => p.jaccard >= 0.5).slice(0, 20);
```

It compares the proposal's trigger against every effective memory and keeps pairs at Jaccard ≥ 0.5.
The result is returned to the caller and surfaced over MCP (`src/mcp/tools.js:16`).

**And no engine decision uses it.** It informs the model and is then dropped. The same computation runs
a second time as a health indicator, `trigger_collision` in `src/engine/health/deterioration.js:136-154`,
which also only reports.

**Meanwhile deduplication is exact.** `sameKnowledge` (`src/engine/contract.js:89-93`) compares the
thirteen `MATERIAL_FIELDS` as serialised JSON. A paraphrase, a reordered list, or one extra word is a
new candidate. So the write path can detect near-duplicates and chooses not to, while the mechanism
that does block duplicates cannot see them.

**One decision is declared and never emitted.** `ADMISSION_DECISIONS` (`src/engine/v2/constants.js:4`)
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
report and the health indicator; reuse it rather than introducing a second constant, and put it in
config next to `vpt_threshold` (`src/store/paths.js`).

## Files

- `src/engine/write.js` — carry the collision into the decision instead of only returning it
- `src/engine/v2/admission.js` — the routing
- `src/mcp/tools.js` — surface the decision so the agent understands why a proposal became a revision
- `src/store/paths.js` — the threshold in `DEFAULT_CONFIG`
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
