---
artifact_class: authored
owner_domain: decisions
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on: []
used_by:
  - runtime/runtime-assumptions-v1
  - failures/context-explosion
do_not_co_load_with: []
---

# DECISION-006 — 65k Token Context Budget Default

Date: 2026-04-26
Status: Accepted

## Context

The v1 planning identified that the original configuration was "VERY aggressive" — specifically 98k context with 16GB cache RAM. With the full stack running (postgres, redis, qdrant, n8n, opencode, observability, embedding model), memory pressure spikes are expected. The user reported typical usage at ~60k tokens, making 65k a reasonable default with headroom.

The llama.cpp service is configured with `--ctx-size 65536`, `--cache-reuse 256`, `--cache-type-k q8_0`, `--cache-type-v q8_0`.

## Decision

Default operational context window: 65k tokens (`--ctx-size 65536`). This provides ~5k headroom above typical ~60k usage. Configurations exceeding 80k tokens are treated as exceptional and require explicit decision artifacts. The embedding service uses a separate, smaller context window of 8192 tokens.

## Consequences

- Context assembly must stay within 65k budget: system prompt + project cognition + retrieved memories + task instructions
- Retrieval injection must be carefully bounded — only the most relevant memories are injected
- Memory compression and summarization become critical to keep retrieved content within budget
- 80k+ context configurations require a decision artifact documenting why the extra budget is needed
- KV cache uses q8_0 quantization for memory efficiency

## Tradeoffs

- **Sacrificed:** Ability to load very large amounts of context in a single inference. Some complex tasks may need to be broken into smaller inferences.
- **Gained:** Stable VRAM usage, predictable behavior, compatibility with full-stack operation, headroom above typical usage.

## Rejected Alternatives

1. **98k context (original configuration)** — Rejected because it creates memory pressure spikes when the full stack is running, risking system instability.
2. **Dynamic context sizing based on task complexity** — Rejected because it adds complexity to the runtime and makes VRAM prediction difficult. Fixed budget is simpler and more predictable.
