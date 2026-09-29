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
catalogue, without looking at what DD delivered. Each is split by task number: odd tasks (dev) tune,
even tasks (test) measure. Changes are chosen on dev only; the test half is the honest number.

## Where delivery stands (0.8.0)

Must-recall on the test halves. Push is what the hooks inject (`npm run bench`); push + pull is what
the agent ends up with, measured with `npm run bench:pull` (Sonnet, memory map left out as it is far
back in a real session, two runs).

| | 0.5.1 push | 0.6.0 push | 0.7.0 push | 0.8.0 push | 0.8.0 push + pull |
|---|---|---|---|---|---|
| Patriark | 0.57 | 0.68 | 0.69 | 0.75 | 0.90 |
| supermem | 0.36 | 0.45 | 0.52 | 0.55 | 0.94-0.96 |

0.8.0 reached 90% through pull: 8 pointers from each ranking's top 20 on prompts and tool calls
(every must memory a pointer showed was pulled), an explicit `retrieve` that returns its fused top 5
below their floors plus its pointers, and a line on non-English prompts asking for a `retrieve` in
English. Push gains came from counting the budget on the rendered pack, the fused leader clearing its
floor on prompts, and a file beside a scoped one keeping the memory applicable. Costs: 6-7 pointer
lines per event (once per memory per session), a `retrieve` on about half the bench's events, and
about 3 memories pulled per event outside the labels. Pull depends on the agent's model: Haiku reaches
0.66-0.79 in supermem.

## Next

- **Replay whole sessions.** `bench:pull` scores each event alone. In a session a memory is pointed at
  once, so a later event where it matters relies on the earlier line still being in context.
- **Cut pull noise.** About 3 memories pulled per event outside the labels, mostly from explicit
  retrieves. Measure any change with `bench:pull --runs=3`: runs of the same setup differ by up to 4
  events of 29.
- **Spot-check the labels.** Both sets were labeled by the agent that wrote the anchors. At 90% a few
  debatable labels weigh as much as a ranking change.
- **Extend the golden sets** with fresh events labeled the same way, so the test halves stay honest as
  anchors and memories grow.
- **Embedding model.** `DD_EMBED_MODEL=multilingual-e5-base` tied e5-small on both halves (79 vs 78
  complete events, 51 vs 53 quiet negatives) for +175 MB and about 30% more per query; e5-small stays
  the default. Revisit with larger golden sets (`npm run bench -- --model=...`).

## Measured and rejected

Each was tried on the golden sets and moved nothing, or bought recall with quiet negatives:

- Cutting by fused rank instead of by floor: top N cannot abstain (supermem kept 2/25 dev negatives).
- Admitting the dense top 1-2 below its floor: no dev gain, 1 to 12 quiet negatives lost.
- More generic request phrasings per memory: dev 0.86 -> 0.80, 11 -> 7 quiet negatives.
- Shortening triggers to fit the 100-character map line: 3 quiet negatives lost, no pull gain.
- Contextual indexing (topic, components, files or keywords prefixed to the embedded text).
- Previous prompt blended into the dense query; per-sentence prompt embeddings.
- Multi-vector embeddings (one per trigger variant, max similarity).
- FTS porter or trigram tokenizers; BM25 column weights.
- Compacting pack text (filler words, operations, repeated paths): more memories fit, no more musts.
- Map lines with anchor keywords: within run-to-run noise.
- Wider pointer pools (beyond the fused lists or the scope gate, or 12 from each top 30).
- A cross-encoder reranker (`bge-reranker-v2-m3`: 2.7 s per event, 778 MB, AUC moved both ways).

## Needs the user

- **Codex SessionStart limit.** `additionalContextLimit` for SessionStart was raised to 24000 so the
  memory map fits; confirm its unit and effect with `scripts/check-codex.mjs` in a project trusted in
  an interactive Codex session.
