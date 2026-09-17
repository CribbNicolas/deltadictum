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
- Host context fills with advice the task did not need, crowding out the code the agent came to read
- Answer quality degrades: the more advice competes for attention, the less any of it steers behaviour
- Hook latency rises on a path that runs on every tool call

## Prevention
- Budget the serialized retrieval result, not the host window: DD cannot know what else occupies it
- Require every candidate to clear both an activation floor and a value-per-token floor
- Downgrade to a smaller compact form before spending more budget
- Bound the number of injected memories with a hard cap, independent of how many matched
- Suppress advice already delivered unchanged in the same session
- Suppress near-duplicate advice inside one pack: the second copy costs tokens and adds nothing

## Recovery
- Lower `budget_tokens` for the affected call; the caller always outranks the default
- Check `cap_saturation` in the health report: a live set that repeatedly fills the hit cap is the
  cause, and the fix is on the write path, not the read path
- Review what is being admitted; a context explosion is usually an admission failure arriving late
