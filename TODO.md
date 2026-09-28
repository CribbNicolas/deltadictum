# TODO

Open work on delivery. Delivery favours recall: an extra memory is cheaper than a missing essential
one, so every item is judged first by what it adds to recall.

## Golden sets

Both projects have a golden set of 100 real events, kept outside git in the project's local data
directory (`npm run golden` writes `<data dir>/golden.json`; the prompts are real and this repository
is public):

- Project-Patriark: `~/.claude/plugins/data/dd-deltadictum/project-patriark-<key>/golden.json`
- supermem: `~/.dd-data/supermem-<key>/golden.json`

Labeled 2026-09-27/28 by the agent at the user's request, from the event text and the memory
catalogue, without looking at what DD delivered. A person should spot-check them. Each is split by
task number: odd tasks (dev) tune, even tasks (test) measure. Changes and anchor updates were chosen
on dev only; the test half is the honest number.

Test half, 0.5.1 -> 0.6.0 (prompt floor, content-free prompts, meta tools, anchor updates):

| | must-recall | events with every must | negatives quiet | strict |
|---|---|---|---|---|
| Patriark 0.5.1 | 0.57 | 13/28 | 12/22 | 28% |
| Patriark 0.6.0 | 0.68 | 16/28 | 15/22 | 38% |
| supermem 0.5.1 | 0.36 | 9/29 | 18/21 | 44% |
| supermem 0.6.0 | 0.45 | 10/29 | 15/21 | 38% |

The dev half reached 0.91 (Patriark) and 0.80 (supermem): anchors fix what they target, and
generalise only partly. Extending the golden sets with fresh events, labeled the same way, keeps the
test half honest as anchors grow.

## Next

- **Spot-check the labels.** Both sets were labeled by the agent that wrote the anchors.
- **Measure the pull path.** The bench scores only what is pushed. Replay golden events with a model
  that reads the session memory map and calls `get`, and score what it pulls.
- **Embedding model benchmark.** Bench e5-small against larger models on the golden sets' test halves.
  A first pass (2026-09-26) found e5-base slightly better (Patriark AUC 0.28 -> 0.36) and e5-large and
  bge-m3 worse at separating off-topic requests, at 1.7x the resident memory.
- **Session context, again.** Adding the previous prompt to a prompt's query helped Patriark (+2
  complete events on dev) and hurt supermem (-1), with more noise in both; revisit with a better way
  to weigh it (for example, only when the prompt itself is short).
- **Old test data.** Tests now write under a temporary data base (`tests/helpers/isolate-data.js`),
  but earlier runs left about 260 `alpha-*`, `beta-*`, `prompt-*`, `dd-mcp-*`, `dd-stress-*` and
  `tmp-*` directories in `~/.dd-data`. Delete them once the user confirms. Earlier ad-hoc scripts also
  wrote synthetic prompts into supermem's real telemetry; golden extraction treats requests that
  differ only in numbers as one.

## Needs the user

- **Codex SessionStart limit.** `additionalContextLimit` for SessionStart was raised to 16000 so the
  memory map fits; confirm its unit and effect with `scripts/check-codex.mjs` in a project trusted in
  an interactive Codex session.
