---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-19
depends_on:
  - architecture/plugin-constraints.md
  - architecture/invariants.md
do_not_co_load_with: []
---

# Auto-accept high-confidence candidates, and a per-user "never seen" mark

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence for this plan |
|---|---|---|
| L1 | Hooks are ephemeral; `PreToolUse` runs on every tool call | Auto-accept must not run in a hook — wrong lifecycle, wrong trust boundary (see below) |
| L2 | No guaranteed persistent process | The audit UI is optional; auto-accept only runs while it's open. No new background process is introduced to work around this — see "Where this runs" |
| L3 | Two dependencies, Node ≥ 22 | **Zero additional model calls.** Explicit requirement from this session: no fresh-context verification pass, no cost added to the write or review path |
| L4 | The hook contract differs per harness | Not relevant — this plan touches only the audit UI, not hooks |
| L5 | A hook failure must never block the host | Not relevant — see L4 |
| L6 | Single-developer volumes | Not relevant — no learned threshold, a human sets one number |
| L7 | Local-first | Both new files (`.dd/config.json`'s new block, `~/.dd-data/seen.json`) are local, git or per-user cache; nothing leaves the machine |

## Invariants this plan must not break

From [`architecture/invariants.md`](../architecture/invariants.md) and `CLAUDE.md`'s non-negotiable
properties, the one this plan sits directly next to:

> Model output never mutates state. Promotion happens only through local human review.
> A reported success is telemetry. It never raises authority, confidence or promotion status.

**INV-04**, enforced today by `HUMAN_REVIEW` — a `Symbol` declared in `src/engine/lifecycle.js:9`
(`export const HUMAN_REVIEW = Symbol('local-human-review')`), required by `admitMemory` (`lifecycle.js:20-21`,
`requireReview(actor)` throws unless `actor === HUMAN_REVIEW`). A `Symbol` cannot cross a serialization
boundary — no MCP tool call, no JSON payload, can ever supply it. Only code that does
`import { HUMAN_REVIEW } from './lifecycle.js'` in the *same process* can call `admitMemory` successfully.
Today that's exactly one place: `src/ui/server.js`, in response to a human clicking "Admit" in the browser.

**This plan does not touch `HUMAN_REVIEW`, `requireReview`, or the MCP surface at all.** Auto-accept is
new code inside `src/ui/server.js` — the same process, the same capability, the same trust boundary that
already exists. It calls `admitMemory(id, { actor: HUMAN_REVIEW, ... })` exactly the way the "Admit"
button's handler does. What's new is *who decides to call it*: a policy the human configured (on/off +
confidence threshold), evaluated against a confidence number the human's own evidence-verification
pipeline already computes — never a number the model supplies. `normalizeProposal`
(`src/engine/contract.js:27-53`) never reads a model-supplied confidence field; that remains true and
unchanged by this plan.

**Why this is different from asking the model "how confident are you"** (explicitly rejected this
session): confidence here is `cappedConfidence`'s output (`src/engine/reliability.js`) — a ceiling
derived from *verified* evidence type (file hash checked, host exit code, explicit user correction), not
a number the model asserts about its own claim. The gate also requires `admitMemory` itself to succeed,
which re-runs every existing safety check (evidence re-verification, live-topic/replacement consistency,
`decideAdmission`'s structural gate) at sweep time, not proposal time — nothing here is a new bypass, it's
the existing human-only promotion path, invoked by policy instead of by click.

## Where this runs — no new background process

Considered and rejected: a `setInterval` sweep. Plugin-constraints.md forbids "background conservation
workers, scheduled jobs, daemons" outright, and it isn't needed. Auto-accept is triggered by:

1. **UI startup** — once, when `startUiServer` is called.
2. **Every `GET /api/atoms`** — the list endpoint the UI's own polling/reload already hits. `refreshIfChanged()`
   already runs on every GET request at `src/ui/server.js:65`; the sweep is one more step in that same
   place, on the same cadence the UI is already using, not a new timer.

If the audit UI isn't running, no sweep runs, no candidate is touched — degrades to exactly today's
behavior (L2).

## Design

### 1. Config: per-project, `.dd/config.json`

New key in `DEFAULT_CONFIG` (`src/store/paths.js:67-79`):

```js
auto_accept: { enabled: false, confidence_threshold: 0.8 },
```

`loadConfig()` (`src/store/git-file-store.js:89-92`) already deep-merges `DEFAULT_CONFIG` under any
stored config one level deep for object-valued keys — an existing `.dd/config.json` with no
`auto_accept` key gets this default with zero migration. `enabled` defaults `false`: this plan does not
turn itself on for anyone.

New HTTP routes in `src/ui/server.js`, next to the existing `/api/feedback/review` pattern (line 73-78):

- `GET /api/config` → `store.loadConfig()`, filtered to the `auto_accept` key (don't expose the whole
  config blob to the browser without reason).
- `POST /api/config/auto-accept` → validate `{enabled: boolean, confidence_threshold: number between 0
  and 1}`, merge into the loaded config, `store.saveConfig(config)`.

### 2. "Never seen": per-user, `~/.dd-data/seen.json`

Not per-project — confirmed this session: a memory belongs to exactly one project, but whether *you've*
looked at it is a fact about you, not the repo. Lives beside the per-project cache directories
`dataBase` already resolves in `src/project.js` (`GROK_PLUGIN_DATA` / `CLAUDE_PLUGIN_DATA` /
`~/.dd-data`), as a sibling file rather than inside any `<slug>-<hash>/` directory, so it's never mistaken
for one project's cache and never wiped by a per-project rebuild.

Shape: `{"<memory_id>": "<iso_timestamp_first_seen>"}`.

- Written by `GET /api/atoms/:id` (`src/ui/server.js:96` onward, the existing detail-fetch handler) —
  opening a memory's detail view marks it seen, once, if not already present.
- Read by `GET /api/atoms` to annotate each returned atom with `seen: boolean` for the list view.

### 3. The sweep itself

**`candidate.confidence`, as stored on a freshly-proposed candidate, is not usable as the threshold
input.** Traced this while writing the implementation plan: `normalizeProposal`
(`src/engine/contract.js:53`) computes it via `cappedConfidence(atom, {authority: 'inferred'})`, and
`cappedConfidence` → `reliabilityCeiling` → `sourceProvenance` reads `atom.evidence_state.artifacts` —
which does not exist yet at proposal time; evidence is only verified later, inside `admitMemory`, at
review. So every model-proposed candidate's stored `confidence` is a constant: the `agent_claim` ceiling
(0.5) times the `model_initiated` capture-origin factor (0.9) = **0.45, regardless of evidence quality.**
Confirmed empirically against this project's own pending candidates: three proposals with different
evidence quality (verified files, an unavailable diff reference, unverified tool_output) all show
`confidence: 0.45`. A threshold compared against this field would not discriminate between well-evidenced
and poorly-evidenced candidates at all.

The sweep must compute the real, evidence-verified number itself — the same two calls `admitMemory`
already makes internally (`src/engine/lifecycle.js:47`) to produce the confidence it actually stamps.
Still zero model calls: `verifyReferences` is deterministic file-hash/exit-code checking, not inference.

New function, e.g. `src/engine/auto-accept.js`, called from the two trigger points in §"Where this runs":

```js
import { verifyReferences } from './evidence.js';
import { cappedConfidence } from './reliability.js';

export async function sweepAutoAccept({ store, projectId }) {
  const config = await store.loadConfig();
  if (!config.auto_accept?.enabled) return { admitted: [] };
  const candidates = await store.listAtoms({ projectId, lifecycleStates: ['candidate'] });
  const admitted = [];
  for (const candidate of candidates) {
    const evidence_state = await verifyReferences(candidate.evidence_refs, { store, projectId });
    const projectedConfidence = cappedConfidence({ ...candidate, evidence_state }, { authority: 'validated' });
    if (projectedConfidence < config.auto_accept.confidence_threshold) continue;
    try {
      await admitMemory(candidate.id, {
        store, projectId, actor: HUMAN_REVIEW,
        rationale: `Auto-accepted: confidence ${projectedConfidence} >= threshold ${config.auto_accept.confidence_threshold}.`,
      });
      admitted.push(candidate.id);
    } catch {
      // Any admitMemory failure (collision, stale replacement target, evidence
      // re-verification failure, etc.) leaves the candidate exactly where a
      // human would find it. Auto-accept only ever does what a click would
      // have done successfully -- it never overrides a rejection.
    }
  }
  return { admitted };
}
```

Deliberately **no pre-check of `decideAdmission` before calling `admitMemory`** — `admitMemory` already
runs that gate internally (`src/engine/lifecycle.js:26`) along with live-topic/replacement consistency.
The `verifyReferences`/`cappedConfidence` calls above are not a duplicate safety check; they compute the
threshold's *input*, which the stored candidate does not carry. `admitMemory` still independently
re-verifies evidence and recomputes confidence fresh for the actual stamp — running it twice here is
redundant work, not redundant authority, and both calls are pure/deterministic, not a cost concern.

### 4. UI

- **Pulsing-dot indicator**, not a text badge (explicit direction this session) — a small CSS-animated
  dot next to any list row where `seen` is `false`. `@keyframes` opacity/scale pulse, `aria-label="not yet reviewed"`.
- **New filters** in the existing filter bar (`src/ui/public/index.html`, alongside the current
  `#filter` lifecycle-state select and `#origin-filter` capture-origin select, lines ~47-56): a
  memory-type select, an "unseen only" checkbox, and a sort control (confidence / created_at /
  activation_count).
- **Settings panel**: a small collapsible section — checkbox "Auto-accept high-confidence candidates" +
  number input for the threshold, `GET`s current state from `/api/config` on load, `POST`s to
  `/api/config/auto-accept` on change.

## Testing

- `sweepAutoAccept`: enabled/disabled, above/below threshold, a candidate that fails `admitMemory` (e.g.
  a live collision) stays a candidate, an already-non-candidate atom is ignored, rationale text includes
  the actual confidence and threshold values.
- Config routes: default when `.dd/config.json` has no `auto_accept` key, round-trip a POST, reject an
  out-of-range threshold.
- `seen.json`: first detail fetch writes an entry, second fetch doesn't duplicate/overwrite the
  timestamp, `GET /api/atoms` reports `seen: true`/`false` correctly, a fresh `~/.dd-data` (no file yet)
  doesn't throw.
- No test asserts on `DEFAULT_CONFIG.auto_admit` (the dead per-type field from an earlier iteration,
  confirmed unused, [[engine/admission/auto-admit-config-unused]]) — this plan does not touch it.

## Done when

- `npm test` passes, including the new suite above.
- A candidate with `confidence` at/above a configured threshold, in a project with `auto_accept.enabled:
  true`, transitions to `active` on the next `GET /api/atoms` without a click — with a rationale string
  naming the policy, visible in its audit history.
- A candidate below threshold, or in a project with `auto_accept.enabled: false` (the default), is
  untouched — identical to today.
- Opening a memory's detail view once is enough to clear its pulsing-dot indicator, in this project and
  in any other project's UI instance (same `~/.dd-data/seen.json`).
- `npm run eval` unchanged — this plan touches no retrieval or ranking code.
