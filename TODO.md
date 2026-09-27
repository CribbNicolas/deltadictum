# TODO

Open work on delivery. Delivery favours recall: an extra memory is cheaper than a missing essential
one, so every item is judged first by what it adds to recall.

## Needs the user

- **Label the golden set.** `npm run golden -- --project=<repo> --data=<data dir>` writes about 100
  real events as unlabeled bench tasks (`.dd/golden.json` by default). Set `must`/`orbit` to the
  topic_keys that apply (or leave `must` empty), delete `unlabeled`, then run the bench on it. This
  is the only measure of the target (90% of events delivered correctly): the bench scenarios were
  written by the agent that wrote the anchors. Project-Patriark's plugin data lives under
  `~/.claude/plugins/data/dd-deltadictum/<project key>`.
- **Codex SessionStart limit.** `additionalContextLimit` for SessionStart was raised to 16000 so the
  memory map fits; confirm its unit and effect with `scripts/check-codex.mjs` in a project trusted in
  an interactive Codex session.
- **Patriark review.** Update its plugin to 0.4.x, then review the pending actions: six `anchor`
  actions for memories created without anchors, one archive of the test memory
  `project-patriark/scenic-preview-weight` (delete it afterwards), and 19 proposals adding
  `anchors.files`.

## After the golden set

- **Measure the pull path.** The bench scores only what is pushed. Replay golden events with a model
  that reads the session memory map and calls `get`, and score what it pulls.
- **Embedding model benchmark.** Bench e5-small against larger models on the golden set. A first
  pass (2026-09-26) found e5-base slightly better (Patriark AUC 0.28 -> 0.36) and e5-large and
  bge-m3 worse at separating off-topic requests, at 1.7x the resident memory.
- **Budget against recall.** With breadth-first packing, supermem's `telemetry-looks-empty` still
  misses `dd/store/data-directory-renames`: four relevant memories match one tool call and even
  their headlines exceed 600 tokens (a legacy headline alone is 161). Decide on the golden set
  whether the default budget should grow, or headlines drop the restated scope.
