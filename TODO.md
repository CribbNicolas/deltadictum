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

- **Cut by rank, not by floor: tried 2026-09-28, mostly refuted.** Delivering the top N after fusion
  cannot abstain: at N=1 supermem kept 2/25 dev negatives quiet (11/25 before). Capping at N among
  those clearing the floor lost recall. Floors or partial gates on top N gained recall only by
  breaking negatives, on tool calls most of all. What stayed: on prompts, the fused leader clears its
  floor when both rankings place it within 5 (`TOP_AGREE_WINDOW`). Test half: Patriark must-recall
  0.69 -> 0.73 (17/28 complete, negatives unchanged), supermem 0.52 unchanged with one more noisy
  negative (12/21); dev half: supermem 0.80 -> 0.84 at no cost.
- **Budget spent on what the agent reads: done 2026-09-28.** Every test-half miss that cleared its
  floor was dropped by the budget with only 3 or 4 memories packed: the budget counted the engine's
  JSON (~50 tokens of keys per memory) and each flagged memory's list of changed files. Counting the
  rendered pack and dropping the file list: test half Patriark 0.73 -> 0.77 (19/28 complete),
  supermem 0.52 -> 0.55 (14/29), negatives unchanged, about 17% more visible tokens per task. A
  larger JSON budget (1100) reached the same recall at about 10% more tokens than this.
- **Where the remaining test-half misses are (2026-09-28, 36 musts).** 5 were the budget drops above;
  about 9 sit in the dense top 3 below their floor (supermem's `environment/dev-machine-harness-clis`
  three times on tool calls); about 12 are far down both rankings, where only phrasings, anchors or a
  label review can help. Many of the rest already arrive as pointers.
- **Rejected: admitting the dense top 1 or 2 below its floor (2026-09-28).** On prompts, tool calls or
  both, with or without a minimum similarity, it added no dev-half event and cost 1 to 12 quiet
  negatives.
- **More request phrasings per memory.** The 0.7.0 backfill added 2 phrasings per memory (one English,
  one Spanish); document expansion usually uses 5 to 8. Extend them, written from the memory's own
  content, never from golden events.
- **Rejected: contextual indexing (2026-09-28).** Prefixing the embedded text with the topic path,
  components, files or anchor keywords raised no dev-half recall; topic plus components only
  raised precision slightly, and on the test half cost Patriark 0.73 -> 0.69 and a quiet negative in
  supermem. FTS already indexes topic_key.
- **Spot-check the labels.** Both sets were labeled by the agent that wrote the anchors.
- **Measure the pull path.** The bench scores only what is pushed. Replay golden events with a model
  that reads the session memory map and calls `get`, and score what it pulls. Push alone is unlikely
  to reach 90% must-recall; pull is where the rest has to come from.
- **Embedding model: e5-base is an option, e5-small stays the default (2026-09-28).** On the golden
  sets at the default floor, e5-base tied: dev 44 vs 45 events with every must memory and 26 vs 27
  quiet negatives; test 35 vs 33 and 25 vs 26. Spanish prompts went both ways (supermem test 0.35 ->
  0.45, dev 0.87 -> 0.78). It costs +175 MB resident memory, 0.7 s vs 0.5 s to load and about 30%
  more per query. `DD_EMBED_MODEL=multilingual-e5-base` selects it; `npm run bench -- --model=...`
  compares. Revisit with larger golden sets. e5-large and bge-m3 were worse in the 2026-09-26 pass.
- **Rejected: session context in the dense query (2026-09-28).** Blending the previous prompt's
  vector into the query (weights 0.3 to 2; always, tool calls only, or prompts under 8 words only)
  never raised dev-half recall; weights of 1 and above cost recall and quiet negatives.
- **Semantic topK 20 had no measured effect.** Kept at 20; the fusion cut did not change enough to
  revisit it.
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
