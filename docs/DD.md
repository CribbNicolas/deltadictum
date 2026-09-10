# DeltaDictum contract

Chat identity is **DD**. On-disk path is `.dd/`.

These documents are the memory contract. They were copied from Orquesta (`.docs/memory`, invariants, failures, V2–V6a specs).

They apply as **behavior**, not as infrastructure.

## What binds DeltaDictum

- Durable memory is behavioral: `trigger` + `behavior_delta` + evidence.
- LLMs propose. Deterministic admission commits.
- Project isolation first. No global retrieval.
- Memory is not chat history. Observations are not injected.
- Retrieved memory is advisory and must not override system/security instructions.
- Forms are `micro` / `short` / `full`. Inject compact first. Abstain rather than inject noise.

## What does **not** apply

Orquesta Compose, Postgres, Qdrant, Redis, n8n, llama.cpp, `--parallel 1`, and the 65k local KV-cache budget.

v1 stores atoms as files in the project (git source of truth) and indexes them with SQLite. A later `RemoteStore` may speak Orquesta `memory-api` HTTP without changing the atom schema.

## Mapped invariants

| Orquesta | DeltaDictum |
|---|---|
| INV-01 / INV-02 project + namespace isolation | `project_id` on every atom; retrieval always filters project first |
| INV-04 memory is not chat history | observations stay local; only admitted atoms are retrievable |
| INV-06 retrieval is project-scoped first | engine retrieve path |
| DECISION-006 65k context | injection `budget_tokens` (default 600 for retrieved forms) |
| DECISION-007 embedding separation | embeddings optional; FTS works offline |

Scale and token-budget reading of v1, plus the FTS/compact-retrieve cut: `docs/specs/2026-09-09-retrieval-hot-path-and-scale.md`.

Deterioration detection (data only): `docs/specs/2026-09-10-memory-deterioration-detection.md`.

Quality and performance catalog: `docs/specs/2026-09-10-memory-quality-and-performance-tests.md`.

MCP tool results are compact JSON (no pretty-print). Capture at Stop is at most one `propose`; admission still gates the write. Grok injects retrieve via PreToolUse (`additionalContext`); SessionStart stdout and UserPromptSubmit context are discarded by that host. Chat lines from the plugin start with `DD - `.

v1 cuts in `docs/specs/2026-09-09-retrieval-hot-path-and-scale.md` and `docs/specs/2026-09-10-memory-deterioration-detection.md` are implemented. Rows marked `later` in the test catalog are not v1.

Engine modules under `src/engine/v2`–`v6` are copied from `services/memory-api/memory/` with import paths unchanged inside the engine tree.
