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
do_not_co_load_with: []
---

# Stage 4 — Provenance: a reliability ladder with a cap per source

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral; `PreToolUse` runs on every tool call | Nothing warm on the hot path |
| L2 | No guaranteed persistent process | No required background worker |
| L3 | Two dependencies, Node ≥ 22 | **No embeddings, no ML libraries** |
| L4 | The hook contract differs per harness | A veto is not portable |
| L5 | A hook failure must never block the host | Every gate needs a failure direction |
| L6 | Single-developer volumes | **No learned weights, no online calibration** |
| L7 | Local-first | No cross-user aggregation |

L6 is why this stage uses a declared ordinal ladder rather than a learned reliability estimate: there is
no volume from which to learn one, and there never will be.

## Invariants this stage must not break

From [`architecture/invariants.md`](../architecture/invariants.md), and these are the load-bearing ones
for this stage:

- **Model output never mutates state.** A proposal cannot set its own reliability; the engine derives it.
- **A reported success is telemetry.** `recordOutcome` (`src/engine/feedback.js:12-13`) must keep
  raising nothing. Provenance is a property of the input, never of how often the memory was used.
- **Evidence establishes integrity, never entailment.** A verified artifact means the bytes were
  checked, not that the claim follows. Review remains a separate tier.
- Promotion happens only through local human review.

## Start here: confirm the ground before writing code

**This document may be wrong.** It was written against the repository at a point in time, and earlier
stages move code. Run the checks below first. If any result disagrees with what the *Starting state*
section claims, **stop and report the difference** instead of proceeding — a plan that no longer
matches the code is information, not an obstacle to route around.

This is not ceremony. Executing this plan has already produced two cases where it mattered: a stage
described one unreachable handler where there were two plus a routing indirection, and a stage
instructed a rule that turned out to be wrong once implemented.

```bash
# The two signals that exist. Expect: capture_origin set in the contract, and
# three provenance values assigned during verification.
grep -n "capture_origin" src/engine/contract.js
grep -n "provenance" src/engine/evidence.js

# That the gate reads neither. Expect: no hit.
grep -n "provenance|capture_origin" src/engine/v2/admission.js

# The constants to replace. Expect: 0.7 at proposal, 0.85 at admission.
grep -n "confidence" src/engine/contract.js src/engine/lifecycle.js

# The pattern to mirror. Expect: one ordered list with derived projections.
cat src/engine/authority.js
```

## Starting state

Both halves of what this stage needs already exist, and the admission gate reads neither.

**Capture origin.** `src/engine/contract.js:30` records `capture_origin` as `model_initiated` or
`user_explicit`, defaulting to `user_explicit` for compatibility with older memories. The MCP schema
describes it accurately (`src/mcp/definition.js:11-12`): *"Use user_explicit only when the user
explicitly asked to save this knowledge... This is not approval."*

**Artifact provenance.** `verifyReferences` (`src/engine/evidence.js:17-43`) assigns each reference one
of three provenances:

| Provenance | Assigned when | Status |
|---|---|---|
| `filesystem` | `file`, `diff` or `test_log` resolved inside the repository and hashed | `verified` |
| `host` | `tool_output` matching a stored observation with `metadata.provenance === 'host'` | `verified` |
| `agent_claim` | everything else, including `user_statement` and `user_approval` | `unverified` |

**And neither reaches a decision.** `decideAdmission` (`src/engine/v2/admission.js:24-53`) is purely
structural — required fields, the anti-memory preventive-language rule, and a safety check. It reads no
provenance and no capture origin.

**Confidence is a boolean wearing a real number's clothes.** `src/engine/contract.js:53` stamps
`confidence: 0.7` on every proposal; `src/engine/lifecycle.js:32` stamps `0.85` on every admitted
memory. Since authority is likewise determined by review status, the retrieval value at
`src/engine/retrieve.js:46`

```js
value = activation × confidence × AUTHORITY_WEIGHT[authority] × usage
```

collapses to activation times a constant. Two of its factors do not discriminate between memories.

## What changes, and why

### The formalisation

Source-sensitive belief change ([arXiv:1704.03396](https://arxiv.org/html/1704.03396)) treats an input
as a pair `(proposition, source)` with a reliability function `R` over a totally ordered value set, and
accepts when the source's reliability exceeds the entrenchment of what is being changed.

The measured counterpoint is worth stating, because it justifies the priority. Nous
([arXiv:2606.22030](https://arxiv.org/abs/2606.22030)) found that belief updating **provides little
benefit over naive last-write-wins** when sources do not differ in trustworthiness. In DD they do
differ, and the difference is discarded. That is what makes this the largest gap rather than a
refinement.

### The design

A declared ordinal ladder, **mirroring `src/engine/authority.js`** — one ordered list with derived
projections. Reuse that shape deliberately: the entrenchment work exists because two authority tables
had drifted apart, and a third independent table would recreate the same failure.

Each level sets a **cap on attainable confidence**, not a fixed value:

| Source | Cap |
|---|---|
| Explicit user correction with a verified artifact | highest |
| Verified `filesystem` artifact | high |
| `host` observation (verified tool output) | medium |
| `agent_claim`, unverified | low |

A cap composes with evidence rather than replacing it: a memory backed by three verified files does not
exceed its source's ceiling, and a memory with a high-reliability source but no verified artifact does
not reach the ceiling either.

### The part that makes it matter

**Apply the cap to the admitted memory's confidence, not only to the proposal.** Candidates are never
retrieved — `retrieveMemories` filters to `['active', 'contested']` — so a proposal-time confidence
affects nothing. Replacing the flat `0.85` at `src/engine/lifecycle.js:32` with a capped value is what
turns `confidence` into a signal that discriminates, and is what stops the retrieval value formula from
collapsing to lexical activation.

### What stays above the cap

**Human review.** A reviewer can grant `canonical`. The ladder bounds what is reachable *without*
review; it does not bound what a human decides. This is the same separation the entrenchment order
already makes between evidence coverage and authority.

## Files

- **New** `src/engine/reliability.js` — the ladder, mirroring `src/engine/authority.js`
- `src/engine/v2/admission.js` — read capture origin and evidence provenance
- `src/engine/contract.js` — derive proposal reliability instead of a flat constant
- `src/engine/lifecycle.js` — cap the admitted confidence
- `docs/memory/memory-admission-control.md` — the gate is no longer purely structural; remove that
  "Not implemented" note and describe what replaced it
- `docs/architecture/project-cognition.md` — the authority and lifecycle section
- `docs/memory/roadmap.md` — gap 1 closes

## Tests

Write these first.

- **The cap holds under volume.** An `agent_claim` memory cannot exceed its ceiling no matter how many
  times it is proposed, re-proposed or reported successful. This is the red-team case: submit many
  low-reliability memories and confirm none reaches the standing of a verified artifact.
- **Human review still wins.** A reviewer granting `canonical` is not clamped by the ladder.
- **Feedback still raises nothing.** Re-assert the existing guarantee explicitly in this stage's tests,
  because this is the stage most likely to erode it by accident.
- **Ordering is total and consistent**, the same property `tests/engine/authority.test.js` asserts for
  the authority ladder: every pair ordered identically by every projection.
- **An unrecognised provenance is treated as least reliable**, never as an average.
- **The eval fixtures are unaffected**: `src/eval/replay.js` seeds through `putAtom`, not `admitMemory`,
  so the replay must not move. Assert this deliberately rather than discovering it.

## Verification

```bash
npm run eval   # compare against the Stage 3 baseline
npm test       # zero failures
```

Evidence coverage must not drop. Retrieval F1 and abstention F1 are compared against the recorded
baseline and **any movement is explained in the commit** — this is the first stage in the plan that
changes the write path and moves ranking, so a silent change is not acceptable.

## Risks and what not to do

- **Do not let reported outcomes feed reliability.** The temptation is real: a memory that "worked"
  looks more reliable. It is the exact attack surface `src/engine/feedback.js:12-13` was written to
  close, since an agent can report its own success.
- **Do not treat `capture_origin: user_explicit` as proof of anything.** It is an agent-reported claim
  that the user asked for a save. It is not authenticated human approval, and the MCP description
  already says so. Only a verified artifact or actual review raises standing.
- **Do not add a third authority-like table.** Mirror `authority.js` and derive.
- Do not raise caps to make an existing memory rank better. If the ladder demotes something that
  deserved to rank, that is information about the memory's evidence, not about the ladder.

## Done when

- The gate reads capture origin and evidence provenance; `confidence` on admitted memories varies by
  source.
- The red-team volume test passes.
- The replay is unchanged, or the change is explained.
- The two documents describe the ladder, and `docs/memory/roadmap.md` records gap 1 as closed.
- One commit explaining why the cap applies at admission rather than at proposal.

## Outcome

Executed 2026-09-18. **218 tests, 218 passing** (202 before, plus the 16 this stage added), 12 passing
stress tests, and the retrieval replay **byte-identical to the stage 3 baseline** — 24/24 exact, f1 1.0,
abstention f1 1.0, evidence coverage 1, 2182 tokens. Nothing in the eval moved, and the reason is the
one the *Tests* section predicted: `src/eval/replay.js` seeds the retrieval fixtures through `putAtom`
with an explicit `confidence: 0.85`, and the write-path probe proposes `source_type: 'file'` references
against files it writes, which verify as `filesystem` and land on the same 0.85 the flat constant used
to stamp. That coincidence is asserted deliberately rather than left to be discovered.

The four *Start here* checks returned what the *Starting state* section predicted, with one line drift:
the admitted constant is at `src/engine/lifecycle.js:33`, not `:32`.

### The ladder as built

| Source | Cap | Assigned when |
|---|---|---|
| `agent_claim` | 0.5 | nothing verified, including `user_statement` and `user_approval` |
| `host` | 0.7 | a `tool_output` reference resolving to a recorded host observation |
| `filesystem` | 0.85 | a `file`, `diff` or `test_log` reference resolved in the repository and hashed |
| `user_correction` | 0.95 | an observed explicit user correction — declared here, produced by stage 5 |

The level is the most reliable **verified** artifact the memory carries, so an unverified reference is an
agent claim whatever source type it names.

**`capture_origin` is a factor, not a rung.** `user_explicit` × 1, `model_initiated` × 0.9, an
unrecognised origin at the lowest factor. A competing *cap* was the first design and was rejected: at
any value low enough to discriminate at the bottom of the ladder, it inverted the ladder, letting an
agent's unverified "the user asked me to save this" outrank a verified repository artifact captured
autonomously. A factor scales every rung equally and therefore cannot invert the order. A test asserts
that directly.

**Human review is above the ladder via `canonical` specifically.** A reviewer granting `canonical` gets
confidence 1; a reviewer granting `validated` accepts the source's ceiling. Reading the *What stays
above the cap* section as "review lifts every cap" would have made the whole stage a no-op, since
confidence is only ever stamped after review.

### Three things a clean-context run should know

1. **The cap is applied from the freshly verified evidence, not the candidate's stored `evidence_state`.**
   `admitMemory` re-runs `verifyReferences`, and that result is what feeds the cap. A candidate's stored
   verification can be stale by review time.

2. **`src/engine/evidence.js` was changed, and it is not in the *Files* list.** `verifyReferences` tested
   `metadata.provenance === 'host'` literally. It now tests membership of `VERIFIED_OBSERVATION_PROVENANCES`,
   derived from the ladder's own `observed` flag. Without this the `user_correction` rung would be
   unreachable declaration, and stage 5 would have to add a second list of which provenances verify —
   exactly the third table the *Risks* section forbids. Observation provenance is stamped by the hook and
   the engine (`src/hooks/run.js:74`, `src/engine/write.js:19-22`); no proposal can supply it, so this
   widens no attack surface.

3. **Three pre-existing tests in `tests/engine/write-retrieve.test.js` were seeding a state the write
   path cannot produce**, and they failed. They made an atom effective with
   `putAtom({ ...atom, lifecycle_state: 'active' })`, keeping the candidate's `authority: 'inferred'` and
   its proposal-time confidence. Only `admitMemory` creates an `active` atom in `src/`, and it always
   stamps a reviewed authority — `active` plus `inferred` is unreachable. Those three now seed what
   admission writes (`validated`, plus the ladder's confidence), which as it happens ranks marginally
   *higher* than the fake state did, 0.85 × 0.5 against 0.6 × 0.7. This is the one place where the plan's
   claim that "a proposal-time confidence affects nothing" needed qualifying: true of the write path,
   false of tests that bypass it.

`docs/DD.md` also gained a contract line, since a cap on attainable confidence is a behavioural
guarantee and not only an internal detail.

### The demotion is real, and intended

An admitted memory with no verified artifact now carries 0.5 rather than 0.85, which roughly halves its
retrieval value and so raises the activation it needs to clear the value-per-token gate. That is the
stage working: per the *Risks* section, a memory the ladder demotes is telling you about its evidence.
The reviewer's remedy is `canonical`, not a higher cap.

## Depends on / unblocks

Depends on **stage 3** for the baseline it is measured against. Stage 5 adds the ladder's top source, so
this stage defines the shape that stage fills: the `user_correction` rung and the ladder-derived set of
verified observation provenances are both in place, and nothing produces that provenance yet.
