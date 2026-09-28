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

0.7.0 (hybrid RRF ranking, agreement gate on prompts, pointer tier, trigger-led memory map, and
English and Spanish request phrasings backfilled into every memory's trigger variants):

| | must-recall | events with every must | negatives quiet | reach (with pointers) |
|---|---|---|---|---|
| Patriark 0.7.0 | 0.69 | 16/28 | 14/22 | 0.82 |
| supermem 0.7.0 | 0.52 | 13/29 | 13/21 | 0.62 |

The dev half reached 0.94 (Patriark) and 0.80 (supermem): anchors fix what they target, and
generalise only partly. Extending the golden sets with fresh events, labeled the same way, keeps the
test half honest as anchors grow.

## Next

- **Cut by rank, not by floor.** Candidates are ordered by reciprocal rank fusion, but what is
  delivered is still cut by each signal's absolute floor. Try delivering the top N after fusion
  instead, and measure it on both test halves.
- **More request phrasings per memory.** The 0.7.0 backfill added 2 phrasings per memory (one English,
  one Spanish); document expansion usually uses 5 to 8. Extend them, written from the memory's own
  content, never from golden events.
- **Contextual indexing.** Prefix each memory's indexed and embedded text with its domain and project
  context before indexing (Anthropic's contextual retrieval). Not tried yet.
- **Spot-check the labels.** Both sets were labeled by the agent that wrote the anchors.
- **Measure the pull path.** The bench scores only what is pushed. Replay golden events with a model
  that reads the session memory map and calls `get`, and score what it pulls. Push alone is unlikely
  to reach 90% must-recall; pull is where the rest has to come from.
- **Embedding model benchmark.** Bench e5-small against larger models on the golden sets' test halves.
  A first pass (2026-09-26) found e5-base slightly better (Patriark AUC 0.28 -> 0.36) and e5-large and
  bge-m3 worse at separating off-topic requests, at 1.7x the resident memory.
- **Session context, again.** Adding the previous prompt to a prompt's query helped Patriark (+2
  complete events on dev) and hurt supermem (-1), with more noise in both; revisit with a better way
  to weigh it (for example, only when the prompt itself is short).
- **Semantic topK 20 had no measured effect.** Kept at 20; revisit if the fusion cut changes.
- **Rejected: a cross-encoder reranker.** `bge-reranker-v2-m3` took 2.7 s per event and 778 MB, and
  moved AUC in opposite directions on the two sets (recorded in `plugin-constraints.md`, L3).
- **Old test data.** Tests now write under a temporary data base (`tests/helpers/isolate-data.js`),
  but earlier runs left about 260 `alpha-*`, `beta-*`, `prompt-*`, `dd-mcp-*`, `dd-stress-*` and
  `tmp-*` directories in `~/.dd-data`. Delete them once the user confirms. Earlier ad-hoc scripts also
  wrote synthetic prompts into supermem's real telemetry; golden extraction treats requests that
  differ only in numbers as one.

## Needs the user

- **Codex SessionStart limit.** `additionalContextLimit` for SessionStart was raised to 24000 so the
  memory map fits; confirm its unit and effect with `scripts/check-codex.mjs` in a project trusted in
  an interactive Codex session.
