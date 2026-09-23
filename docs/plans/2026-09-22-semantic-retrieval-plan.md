# Semantic retrieval: prod-a (lexical) vs prod-b (embeddings in a resident process)

Status: phases 1-5 implemented 2026-09-22; phase 6 pending. Decision owner: the user.

## Why the constraint changes

L2 and L3 in `docs/architecture/plugin-constraints.md` were written while removing the Orquesta system,
whose embeddings lived in a separate service (llama.cpp, Docker, Qdrant, PostgreSQL). That cannot ship
in a plugin. The removal generalised it to "no embeddings", which does not follow: an ONNX runtime inside
a Node process is an npm package with prebuilt binaries.

Measured on this machine (Windows, Node 24, `@huggingface/transformers` 4.3.0,
`Xenova/multilingual-e5-small` q8): install 479 MB, model 130 MB; first load 29 s (download), cached
load 0.5 s, one query embedding 3 ms warm, 384 dimensions.

So L1 still holds (0.5 s per hook process is not acceptable on every tool call) and the model can only
live in a long-lived process. L2 becomes "a resident process may be started and relied on for better
answers, never for correct ones": hooks fall back to lexical retrieval when it is absent (L5).

## Phases

1. **Constraints and language.** Relax L2/L3 in the docs. Memories are authored in English whatever the
   conversation language (tokens, and one vocabulary for matching); the model is multilingual anyway.
2. **Benchmark.** Scenarios written from the real store: each names the memories it *must* get and the
   ones that *orbit* it (useful, not required), in the three shapes DD sees: a user prompt (English and
   Spanish), tool calls on the files involved, and unrelated work that must stay quiet. Memories may be
   added to make a case realistic. Metrics: must-recall, orbit-recall, precision, abstention, injected
   tokens.
3. **prod-b.** Vectors per atom in the SQLite index, keyed by model and text hash; candidates are the
   union of FTS and nearest vectors; activation takes the best of lexical, scope and calibrated
   similarity; applicability gates are unchanged. Knobs: similarity floor, calibration, weight.
4. **Compare** prod-a and prod-b on the benchmark, then calibrate the winner.
5. **Resident process.** The audit UI process already answers hooks (`src/hooks/bridge.js`); it loads
   the model and serves prod-b. SessionStart starts it when absent; the banner says when it is not
   running and how to fix it (README section: task). The embedding runtime is an optional dependency.
6. **Agent-level measurement.** The same task run without DD and with DD, comparing result and tokens
   (`src/eval/model-runner.js`).

## Open items

- `memory/product/not-embeddings` (anti-memory, active) contradicts this plan; supersede it through
  review once the comparison is in.
- Patriark's memories are in Spanish; they become the multilingual test corpus before translation.

## Results (2026-09-22, `npm run bench` / `npm run bench:semantic`)

15 tasks from this repository's store (11 with needed memories, 4 that must stay quiet), 45 probes.

| | must recall | orbit recall | precision | quiet negatives | tokens/task |
|---|---|---|---|---|---|
| prod-a lexical, before the reach fixes | 0.59 | 0.14 | 0.78 | 4/4 | 376 |
| prod-a lexical, with headlines | 0.67 | 0.23 | 0.80 | 4/4 | 409 |
| **prod-b semantic, floor 0.04** | **0.83** | **0.32** | **0.86** | **4/4** | 519 |
| prod-b semantic, floor 0.025 | 0.83 | 0.45 | 0.85 | 3/4 | 624 |

prod-b wins on every axis at the default. Its one calibration dial is `floor`: must-recall holds at 0.83
from 0.015 to 0.04, and lowering it buys orbit recall at the cost of silence. `topK` (3-8) changes nothing.
Cross-language works: Spanish prompts place English memories as well as English prompts do.

Found and fixed while measuring: a memory whose micro form is the whole behaviour (~470 tokens) filled the
pack alone; lower-ranked applicable memories now arrive as a one-sentence headline with the id to `get`.

End to end: a real `UserPromptSubmit` hook, bridged to the resident process, returns the needed memory in
~36 ms. The resident answers only when it runs this build and its code is unchanged since it started;
otherwise hooks fall back to lexical retrieval and SessionStart replaces it.

## Second corpus: Project-Patriark (Spanish memories)

11 tasks, 34 probes, English and Spanish prompts against Spanish memories:

| | must recall | orbit recall | precision | quiet negatives |
|---|---|---|---|---|
| prod-a lexical | 0.36 | 0.39 | 0.60 | 3/3 |
| **prod-b semantic** | **0.49** | **0.43** | **0.64** | **3/3** |

prod-b wins again, but both are far below supermem. The misses are memories of about 60 characters of
terse Spanish ("Enumerar probabilidades y verificar..."): there is little text for either retriever to
match. The fix is in the memories, not the retriever: English and a full sentence of behaviour.

Tried and reverted: weighting a file-scope match by glob specificity (a broad `src/domain/**` only
admits a memory). It raised Patriark precision (0.51 to 0.61) but lowered supermem semantic precision
(0.86 to 0.79) and Patriark recall; a weak activation for broad globs (0.45) was worse everywhere.

## Project-wide scopes and per-project calibration (2026-09-22, later)

After the day's own memories were auto-accepted, one of them (a tooling lesson scoped to `src/**`) was
injected into every supermem task. A file scope that fixes at most one directory now admits a memory
without activating it (`projectWideScope` in `src/engine/activation.js`); two-segment scopes such as
`src/domain/**` still activate.

| | must | orbit | precision | quiet |
|---|---|---|---|---|
| supermem lexical | 0.80 | 0.18 | 0.84 | 4/4 |
| **supermem semantic** | **0.92** | 0.18 | **0.84** | 4/4 |
| Patriark lexical | 0.33 | 0.27 | 0.64 | 3/3 |
| **Patriark semantic** | **0.46** | 0.30 | **0.72** | 3/3 |

The semantic floor is now per project (`semantic.floor` in `.dd/config.json`, default 0.04). Patriark at
0.025 reaches must 0.68 with precision 0.70, at the cost of one of three negatives; supermem keeps must
0.92 from 0.015 to 0.04 and needs 0.04 to stay fully quiet. Translating Patriark's missed memories to
English moved semantic must recall from 0.49 to 0.54 only; lexical did not move, because prompts rarely
share 35% of a trigger's words.

## Still open

- Phase 6: the same task with and without DD, comparing outcome and tokens (`src/eval/model-runner.js`).
- Patriark as a second, Spanish, benchmark corpus; then translate its memories (new ones are refused).
- ~~The MCP `retrieve` tool runs lexically in the session's process~~: it now asks the resident first.
- ~~Session dedup re-delivers after 1 hour~~: the window is one day (`since(1)` counts days). Repeats seen
  during the session came from two builds answering hooks with different revision formulas, which gap 7
  now prevents. Parallel hook processes did race (two of six delivered under load); delivery is now claimed
  in one SQLite statement (`claimDelivery`), covered by `tests/hooks/parallel-delivery.test.js`.
- README section "Resident process": how to tell whether it runs and how to fix it (the SessionStart notice
  already points there).
- `memory/product/not-embeddings` and `memory/retrieval/compact-fts` describe the old design; revise in review.
