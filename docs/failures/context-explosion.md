---
artifact_class: authored
owner_domain: failures
artifact_type: reference
stability: stable
last_validated: 2026-04-26
depends_on:
  - runtime/runtime-assumptions-v1
  - decisions/DECISION-006-65k-context-budget
used_by: []
do_not_co_load_with: []
---

# Context Explosion

## Trigger Conditions
- Retrieved memories exceed the context budget when combined with system prompt, project cognition, and task instructions
- Multiple large artifacts are injected without compression or summarization
- Context window configuration exceeds 80k tokens without a decision artifact
- Memory importance scoring is absent or ineffective, causing low-value memories to be included

## Symptoms
- Inference latency increases dramatically (tokens/sec drops below acceptable threshold)
- GPU VRAM usage spikes, potentially causing OOM errors or thermal throttling
- Model output quality degrades (hallucinations, lost context, truncated responses)
- Queue wait time increases as each inference takes longer

## Prevention
- Enforce 65k token context budget default (`--ctx-size 65536`)
- Apply memory importance scoring (0.0–1.0) before retrieval injection; only include memories above threshold
- Compress and summarize long memories before inclusion in context
- Bound the number of retrieved memories (e.g., top-N by importance)
- Require decision artifact for any configuration exceeding 80k tokens

## Recovery
- Reduce context budget mid-inference is not possible; abort current inference and retry with fewer retrieved memories
- Kill the stalled inference via llama.cpp API (`/v1/chat/completions` cancellation)
- Clear the KV cache (`--cache-reuse` parameters) to free VRAM
- Review memory compression policies — increase summarization aggressiveness
