# TODO

Open work on delivery. Delivery favours recall: an extra memory is cheaper than a missing essential
one, so every item is judged first by what it adds to recall.

## Golden set

Project-Patriark's golden set is `C:\dev\Project-Patriark\.dd\golden.json`: 100 real events (57
with expected memories, 43 where nothing should be delivered), labeled 2026-09-27 by the agent at
the user's request from the event text and the memory catalogue, without looking at what DD
delivered. A person should spot-check it; the agent that labeled it also wrote the anchors.

With the defaults of 0.5.1 (semantic floor 0.035 now actually applied, budget 800):

| | must-recall | events with every must | negatives quiet | strict |
|---|---|---|---|---|
| 0.5.0 defaults (0.04, 600) | 0.45 | 21/57 | 27/43 | 34% |
| 0.5.1 defaults (0.035, 800) | 0.59 | 29/57 | 26/43 | 33% |

## Next, measured on the golden set

- **Prompts miss; tool calls add noise.** 19 of the 28 events with a missed memory are prompts
  (design conversations in Spanish naming no anchor: the map generator, randomness, dice), and 15
  of the 17 noisy negatives are tool calls on central files (`architecture/core/engine-independent`,
  `ui/player-menu/sections`, `gameplay/core/dice-resolution-plan`). Candidates: session context in
  the query for prompts (the last prompts with content), and a stricter semantic floor for tool
  calls than for prompts.
- **Measure the pull path.** The bench scores only what is pushed. Replay golden events with a model
  that reads the session memory map and calls `get`, and score what it pulls.
- **Embedding model benchmark.** Bench e5-small against larger models on the golden set. A first
  pass (2026-09-26) found e5-base slightly better (Patriark AUC 0.28 -> 0.36) and e5-large and
  bge-m3 worse at separating off-topic requests, at 1.7x the resident memory.

## Needs the user

- **Codex SessionStart limit.** `additionalContextLimit` for SessionStart was raised to 16000 so the
  memory map fits; confirm its unit and effect with `scripts/check-codex.mjs` in a project trusted in
  an interactive Codex session.
