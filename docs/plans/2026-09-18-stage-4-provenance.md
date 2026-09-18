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

## Depends on / unblocks

Depends on **stage 3** for the baseline it is measured against. Stage 5 adds the ladder's top source, so
this stage defines the shape that stage fills.
