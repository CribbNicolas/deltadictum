---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - plans/2026-09-18-stage-4-provenance.md
do_not_co_load_with: []
---

# Stage 5 — Observe user corrections

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral Node processes; `PreToolUse` runs on every tool call | **Detection must be cheap and synchronous** |
| L2 | No guaranteed persistent process | No required background worker |
| L3 | Two dependencies, Node ≥ 22 | **No model call, no embeddings — detection is lexical** |
| L4 | The hook contract differs per harness | Do not assume a payload shape |
| L5 | A hook failure must never block the host | **The prompt hook must still return its context if observation fails** |
| L6 | Single-developer volumes | No learned classifier |
| L7 | Local-first | No cross-user aggregation |

L1, L3 and L5 together determine the whole design: a deterministic lexical detector that runs inline and
cannot take the hook down with it.

## Invariants this stage must not break

From [`architecture/invariants.md`](../architecture/invariants.md): model output never mutates state; a
reported success is telemetry; evidence establishes integrity, never entailment; **a hook that fails
must degrade to silence rather than damage the session**.

An observation is evidence, not knowledge. Nothing here writes a memory.

## Start here: confirm the ground before writing code

**This document may be wrong.** It was written against the repository at a point in time, and earlier
stages move code. Run the checks below first. If any result disagrees with what the *Starting state*
section claims, **stop and report the difference** instead of proceeding — a plan that no longer
matches the code is information, not an obstacle to route around.

This is not ceremony. Executing this plan has already produced two cases where it mattered: a stage
described one unreachable handler where there were two plus a routing indirection, and a stage
instructed a rule that turned out to be wrong once implemented.

```bash
# What becomes an observation today. Expect: failures and validation commands only.
cat src/hooks/observe.js

# The hook to attach to. Expect: the prompt branch already holds the text.
grep -n "command === 'prompt'" -A 10 src/hooks/run.js

# The lexical precedent to follow. Expect: an EN/ES regex in the anti-memory rule.
grep -n "anti_memory" -A 2 src/engine/v2/admission.js

# The ladder this source joins. Expect: it to exist, from stage 4.
ls src/engine/reliability.js
```

## Corrections from stage 4

Stage 4 shipped and moved code this document describes. Checked 2026-09-18 against commits `3c83529`
and `29926ef`; the four *Start here* checks all still return what they should. What changed:

**The ladder work in the *Files* list is already done.** The `user_correction` rung exists in
`src/engine/reliability.js` with the highest cap, and `verifyReferences` derives which observation
provenances count as verified from the ladder's own `observed` flag rather than testing `'host'`
literally. Verified end to end: an observation stamped `metadata.provenance: 'user_correction'`, cited
as a `tool_output` reference, verifies and admits at 0.95. **Do not add a rung and do not add a second
list of verified provenances** — that is the third table `stage 4`'s risks section forbids. This stage's
only job on the reliability side is to stamp that provenance when it writes the observation.

**The Stop prompt does not surface observations from `src/hooks/capture.js`.** That file is a static
prompt string and nothing else. The surfacing is `src/hooks/run.js:86`, which appends
`Available host evidence for this session (get by ID; source_type=tool_output, source_ref=ID)`. A user
correction is not host evidence, so that wording is what needs to change, in `run.js` — `capture.js` at
most gains a sentence.

**Codex Stop fires on any observation, not only a host one.** `src/hooks/run.js:82` skips the Codex
capture turn when the session recorded no observations, with a comment scoping that to host validation
and failure. Once a correction is an observation, a corrected turn will spend a Codex continuation.
Decide that deliberately rather than inheriting it.

**One line number drifted.** The anti-memory regex is at `src/engine/v2/admission.js:46`, not `:40`; the
gate gained a reliability read above it. `src/hooks/observe.js:3-22` and `:16-17`, `src/hooks/run.js:60-71`
and `:13-18` are all unchanged.

## Starting state

**Only two things become observations.** `observationFromTool` (`src/hooks/observe.js:3-22`) returns
`null` unless the tool call either failed or was a validation command:

```js
const failed = payload.is_error === true || response.is_error === true || (typeof exit === 'number' && exit !== 0);
const validation = typeof exit === 'number' && exit === 0 && /\b(test|pytest|jest|vitest|lint|typecheck|tsc|check)\b/i.test(command);
if (!failed && !validation) return null;
```

Everything else is discarded. The observation carries `metadata.provenance: 'host'`, which is what
lets `verifyReferences` treat a `tool_output` reference as verified.

**The highest-reliability signal available is not among them.** When the user corrects the agent, that
correction is the most trustworthy input DD will ever see, and nothing records it. Whether it reaches
memory depends entirely on the model remembering to propose it during the `Stop` prompt
(`src/hooks/capture.js`).

**The hook it would attach to is already wired.** `UserPromptSubmit` runs `src/hooks/run.js:60-71`,
which already has the prompt text and the session:

```js
const action = payload.prompt || payload.text || payload.user_prompt || '';
```

It currently uses that text only to retrieve, then discards it.

**There is precedent for lexical detection in this codebase.** The anti-memory rule at
`src/engine/v2/admission.js:40` is an English/Spanish regular expression over preventive language.
This stage follows that pattern rather than inventing one.

## What changes, and why

Add `observationFromPrompt` to `src/hooks/observe.js` and call it from the `prompt` branch, recording a
user correction as a first-class observation with its own source type.

### Detection

Deterministic and lexical, English and Spanish, matching the existing precedent. The signal is
corrective language directed at what just happened — negation of a prior action, an instruction to stop
or undo, a substitution ("use X instead"), an assertion that something is wrong.

**A lexical detector has false positives, and here they are cheap.** The output is an *observation*,
which is evidence for a proposal that still requires human review before it becomes knowledge. Nothing
is promoted by being detected. What must not happen is inflating reliability: the observation carries
its own provenance, and **stage 4's ladder decides what ceiling that provenance earns** — this stage
does not assign confidence.

**False negatives are the more expensive error** and should shape the regex: a missed correction is the
status quo, silently.

### Redaction and bounds

Reuse the treatment `observationFromTool` already applies at `src/hooks/observe.js:16-17` — sanitise,
redact secret-shaped assignments and common token formats, and truncate. A user prompt is more likely
to contain pasted credentials than a tool's stderr, so this is not optional.

### Failure direction

L5 is explicit here: if observation throws, `UserPromptSubmit` still returns its retrieval context. The
memory benefit of recording a correction never justifies degrading the turn it was observed in.

## Files

- `src/hooks/observe.js` — new `observationFromPrompt`, reusing the existing redaction
- `src/hooks/run.js` — the `prompt` branch records the observation before retrieving
- ~~`src/engine/reliability.js`~~ — nothing to do; stage 4 already declared and wired the rung, see
  *Corrections from stage 4* above
- `src/hooks/run.js` — the `Stop` branch can now surface correction observations as available evidence,
  the same way it surfaces host observations today. This is where the surfacing lives, not
  `src/hooks/capture.js`
- `docs/architecture/project-cognition.md` — the capture section
- `docs/memory/roadmap.md` — Phase 2 item closes

## Tests

- Corrections in **English and Spanish** are detected. Include realistic phrasing, not keyword bait.
- An ordinary request is **not** detected as a correction. This is the test that keeps the review queue
  usable, so give it more cases than the positive one.
- A prompt containing a secret-shaped assignment is redacted, matching the tool-observation behaviour.
- **`UserPromptSubmit` still returns its context when the observation write throws.** Force the failure;
  do not assume it.
- The observation carries the provenance stage 4 expects, and does not set confidence itself.
- The Codex path (`src/hooks/run.js:13-18`) is unaffected: it rewrites `Stop`, not `UserPromptSubmit`.

## Verification

```bash
npm test       # zero failures
npm run eval   # unchanged — this stage does not touch retrieval
npm run test:stress
```

The stress run matters because this adds work to a hook that runs on **every user prompt**. Compare
against the previous run; the cost is a regex over a bounded string, so any visible movement means
something else was added by accident.

Then exercise it by hand: correct the agent in a real session, open the audit UI, and confirm the
observation appears with sensible text.

## Risks and what not to do

- **Noise is the failure mode to watch.** If everything looks like a correction, the review queue
  floods and stage 4's top reliability tier becomes meaningless. Set the acceptance criterion on real
  prompts collected from actual sessions, not on the regex author's intuition about what a correction
  sounds like.
- **Do not attempt to infer what the correction was about.** That needs conversation history the hook
  does not have, and a model it cannot call (L1, L3). The observation records that a correction
  happened and what was said. Connecting it to a behaviour is the model's job at proposal time.
- **Do not treat detection as approval.** A detected correction is `user_explicit` evidence at most; it
  is not authenticated human approval and does not promote anything.
- **Do not store the raw prompt unbounded.** Same limits and redaction as tool observations.

## Done when

- A user correction in either language becomes an observation, visible in the audit UI and referencable
  by ID at proposal time.
- An ordinary request does not.
- The prompt hook still returns context when observation fails.
- The capture prompt surfaces correction observations alongside host evidence.
- One commit explaining why the detector is lexical and why false positives are the cheap error here.

## Depends on / unblocks

Depends on **stage 4**, which defines the ladder this source sits at the top of, and on **stage 3** for
the baseline. Feeds stage 6: repeated corrections on the same topic are exactly the near-duplicates that
stage acts on.
