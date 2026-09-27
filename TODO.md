# TODO

Open work from the anchored-delivery change (PR #11). Delivery favours recall: an extra memory is
cheaper than a missing essential one, so every item below is judged first by what it adds to recall.

## Measurement

- **Golden set from real traffic.** Sample about 100 events (prompts and tool calls) from the
  retrieval telemetry of Project-Patriark and supermem, have the user label which memories apply to
  each (or none) in the audit UI, and gate CI on it. The bench scenarios were written by the agent
  that wrote the anchors, so they cannot show the target (90% of events delivered correctly).
- **Measure the pull path.** The bench scores only what is pushed. Replay tasks with a model that
  reads the session memory map and calls `get`, and score what it pulls.
- **supermem recall regression.** With recall first, supermem must-recall is 0.89 against 0.94
  before anchoring: `codex-reinstall` misses `distribution/npm-hoisted-dependency-check` and
  `grok-opencode-check` misses `environment/dev-machine-harness-clis`. Find out whether the anchored
  revisions lost usage history, lexical activation or semantic rank.

## Anchors

- **Learn missed anchors, with review.** When the agent pulls a memory with `get` that was not pushed
  in that session, suggest an `anchor` action adding the request's words (grounded through a new
  trigger variant). The user applies it; nothing is learned online (L6).
- **Validator gaps found in use.** `node -e` normalizes to `node e` and matches any "node e..."; a
  lone `audit` fires on "audit UI". Refuse keywords that contain a single-letter token after
  normalization, and warn on a keyword that is a prefix of a frequent phrase in the project's text.
- **Central files.** Warn at filing time (not only in `health`) when an anchor file already anchors
  three or more memories.
- **Remaining unanchored memories.** 5 supermem anchor proposals are still pending review, and 5
  supermem memories and `project-patriark/scenic-preview-weight` (a test memory to delete) have no
  anchors. File `anchor` actions for the rest.
- **Patriark anchor files.** 19 proposals adding `anchors.files` are pending in Patriark's audit UI;
  they carry the same evidence reference twice (harmless, from the backfill script).

## Hosts

- **Codex SessionStart limit.** `additionalContextLimit` for SessionStart was raised to 16000 so the
  memory map fits; confirm its unit and effect with `scripts/check-codex.mjs` in a trusted project.
- **OpenCode.** Confirm the memory map arrives through `experimental.chat.system.transform`.

## Model

- **Embedding model benchmark.** Bench e5-small against larger models with the golden set. A first
  pass (2026-09-26) found e5-base slightly better (Patriark AUC 0.28 -> 0.36) and e5-large and
  bge-m3 worse at separating off-topic requests, at 1.7x the resident memory.
