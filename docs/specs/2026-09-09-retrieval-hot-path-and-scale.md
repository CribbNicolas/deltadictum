---
artifact_class: authored
owner_domain: memory
artifact_type: spec
stability: implemented
last_validated: 2026-09-10
depends_on:
  - memory/retrieval-router.md
  - architecture/invariants.md
  - failures/context-explosion.md
  - failures/memory-contamination.md
used_by:
  - specs/2026-09-10-memory-deterioration-detection.md
  - specs/2026-09-10-memory-quality-and-performance-tests.md
---

# Retrieval hot path, token budget, and scale

Date: 2026-09-09
Status: **Implemented** (P0/P1 cut). Later phases stay deferred.

## Context

DeltaDictum's differentiator is not "remember the chat". It is **behavioral memory**: `trigger` + `behavior_delta` + evidence, admitted deterministically, injected only when the next action activates it, shared as git files, audited in a local UI.

That contract is real. The 2026 memory market (claude-mem, Mem0, Zep/Graphiti, Letta, CLAUDE.md) already covers session dumps, vector fact layers, temporal graphs, and always-on markdown. Copying those would erase the thesis.

This spec records an honest performance reading of v1 as implemented, and the first cut that makes the thesis measurable.

## Honest reading (before this cut)

| Question | Answer |
|---|---|
| Fewer tokens than claude-mem / Mem0 / pasting history? | **On paper, injection yes** (budget 600, `micro`/`short`, abstain). **In practice, unmeasured.** MCP `retrieve` returned the **full atom JSON**, so the tool result could dwarf the compact `content`. |
| More interesting memories? | **Schema yes. Capture no.** Observations are not promoted. Quality depends on the host LLM calling `propose` well. |
| Scale to ~1,000 atoms? | **Files are fine. The read path is not.** Retrieve did a full git JSON walk and scored every atom in JS. FTS5 existed and was unused. |

The router doc describes hybrid BM25 + embeddings + RRF. v1 code did `listAtoms` (git walk) + lexical trigger overlap.

### Token counters (three, not one)

1. **Injected form budget** — `DEFAULT_BUDGET_TOKENS = 600`, `value_per_token` gate. This is the intended saving.
2. **MCP tool payload** — JSON of every field on the atom. This is where v1 leaked.
3. **Host injection** — Grok ignores SessionStart stdout. If the model never calls retrieve, cost is 0 and so is value.

v1 also had no hit cap. `micro` forms of ~8 tokens can fill 600 tokens with **~75 memories** if triggers share stopwords (`before`, `when`, `writing`).

Trigger score was `shared_tokens / trigger_tokens` including stopwords. `before writing durable memory` vs `before writing tests` scored 0.5. Combined with `VPT_THRESHOLD = 0.005`, generic triggers inject noise.

### Indexing as implemented (before this cut)

- Git files under `.dd/atoms/` are the source of truth (correct for team share).
- SQLite FTS5 indexes `title`, `trigger`, `what`, `why`, `topic_key`, `micro`, `short`.
- `store.search()` existed.
- `retrieveMemories` called `store.listAtoms` → **git walk of atoms + archive**, parse every JSON, score in JS.
- `getAtom` also walked every file.
- Successful retrieve rewrote the git atom to bump `activation_count` (dirty diffs, extra IO).

At ~30 atoms this looks magical. At ~1,000 it is a table scan. At ~10,000 it stops being a "thin plugin".

The admission gate is the other scale defense: a large repo should not have 1,000 *active* lessons. If it does, forgetting failed first. Target live set is tens to low hundreds, not thousands. The engine must still be O(hits), not O(corpus), so a bloated store cannot melt retrieve.

## What not to copy

- Embeddings-first (Mem0): drops "activate before this action", becomes RAG over notes.
- Auto session summaries (claude-mem): Orquesta V1 contamination.
- Temporal knowledge graph (Zep) in this cut: construction cost, not needed for coding lessons.
- Injecting 1,000 micros "just in case": abstention is the feature.

Double down on: **few memories, expensive to write, cheap to read, activated by the next action, human-auditable.**

## P0/P1 cut (in this change)

Out of scope: embeddings, admission-schema changes, auto-extract from observations, decay/forgetting, contradiction UI, remote store.

### 1. Compact retrieve

`retrieveMemories` (and therefore `retrieve`) returns hits shaped as:

```text
id, topic_key, memory_type, title, trigger,
form_type, content, token_estimate,
activation_score, contested, lifecycle_state
```

`what`, `why`, `evidence_refs`, `retrieval_forms`, timestamps, and registry ids stay on disk. `get` remains the full form.

### 2. FTS candidate generation + caps

Hot path:

```text
project + lifecycle + type  (SQLite)
→ FTS5 MATCH on trigger/title/topic/micro/short  (top 50)
→ triggerActivationScore on those candidates
→ value_per_token + budget + max 8 hits
```

Reads (`listAtoms`, `getAtom`, retrieve candidates) go through SQLite. Git remains the write / clone / PR path.

FTS query is built from action+query tokens, quoted, OR-combined, with stopwords removed. MATCH failures fall back to a filtered SQLite list (still not a git walk).

### 3. Activation is local telemetry

`activation_count` updates SQLite only. Retrieve must not rewrite git atoms. Shared git history is for admitted content, not hit counters.

### 4. Stricter activation

- Ignore stopwords when computing overlap (`before`, `when`, `the`, …). Exact substring containment still scores 1.
- Default `value_per_token` threshold raised from `0.005` to `0.02`.
- Hard cap: **8** injected memories per retrieve.

### 5. Regression at 1,000 atoms

A test writes 1,000 active atoms plus one needle. Retrieve by the needle trigger must:

- return the needle
- return at most 8 hits
- return compact hits (no `evidence_refs`)
- finish in well under a second on a dev machine

## Later (not this cut)

| Item | Why later |
|---|---|
| Optional embeddings + RRF | V7 in the router doc. FTS is enough at 1k. |
| Observation → at most one Stop candidate | Stop hook asks for at most one `propose`. Observations are still not promoted. |
| Decay / auto-archive unused inferred atoms | Auto-archive still later. Detection is spec 2026-09-10-memory-deterioration-detection.md. |
| Use-feedback on memories | Requires a signal we do not collect yet. |
| Eval harness remainder | Abstention F1 is in `npm test`. Payload/content ratio under 4x and host traces stay later (catalog Q15, H1-H5). |

## Success for this cut

- MCP retrieve payload is small enough that `budget.used` is in the same order as tokens the model actually reads for hits.
- Retrieve does not dirty `git` for telemetry.
- 1,000-atom corpus does not change retrieve complexity class.
- Unrelated actions still abstain.
- Exact trigger match still injects `short`/`micro`.
