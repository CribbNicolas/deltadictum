---
title: Where DD came from
description: "Where DeltaDictum v1 went wrong, what measurement showed about it, and the mistakes v2 must not repeat."
parent: Architecture
nav_order: 4
---

# Where DD came from

DD v2 replaced v1's core in October 2026. This page keeps, in short, what v1 was, what measurement showed
about it, and the mistakes v2 must not repeat. The full analysis is the owner's research note
(`docs/research/2026-10-delivery-cost-research.md`, kept outside git).

## v1 in one paragraph

v1 (0.1 to 0.8) retrieved memories by search. Every prompt and tool call ran full-text and embedding
retrieval, fused by reciprocal rank, inside a resident process one per machine; session start injected a map
of every memory; an MCP server offered orient, retrieve, get, propose and act; anchors, an actions queue, a
confidence ladder and an audit UI sat around it. It needed three dependencies, including a local embedding
model, and its hook took a median of 128 ms.

## What measurement showed

The 2026-10 quality trial on this repository's 15 tasks found the answers good and the key memories recalled,
but DD cost 24 to 31 percent more than the agent with a referenced guide, and all of the extra came from
injected context. Four "hub" memories reached 14 or 15 of the 15 tasks by similarity. Triggers on the files
each memory already named would have delivered the key memory in 30 of 30 runs, at about 375 tokens a task.

## Mistakes not to repeat

- **Similarity decides topic, not applicability.** Search delivered memories that were about the subject but
  not about the action. v2 fires a memory only when one of its trigger rules matches the event.
- **Caps hide the cause.** Limiting how many memories a turn receives treats the symptom; the question is why
  an irrelevant memory was selected at all.
- **Fixed context is paid every session.** A memory map, MCP tool descriptions and long skill descriptions cost
  tokens whether or not anything applies. v2 injects nothing at session start and runs no MCP server.
- **Timing matters as much as content.** Knowledge delivered at the prompt arrives before the agent knows which
  file it will touch; v2 delivers at the tool call, once per epoch.
- **A process every machine must keep running is a product of its own.** v2 has no resident, no model and no
  dependency.
- **Payload shapes come from recordings, not documentation.** A documented hook payload differed from what the
  harness sent; record real payloads before building on them.
- **One harness at a time.** Changing every harness together never finishes (owner, 2026-10-13): Claude Code
  first, with favourable results on the defined benchmarks, then Codex, then Grok Build, then OpenCode.
- **A reported success is not evidence.** Nothing the model says about itself activates a memory.

## What comes next

1. Done (2026-10-14): the agent trial on the 15 tasks. Against the agent alone on the same day, v2 resolved
   as many tasks, scored 7 points more on code quality and met every project requirement, at 1% more cost
   ([how it is measured](../guide/how-it-works.md#how-it-is-measured)). A second trial with Opus 5.5 and
   Haiku 5.5 at high effort met every requirement in every condition, a ceiling on that task set, and kept
   DD the cheapest condition ([write-up](../benchmarks/2026-10-v2-trial-opus-haiku.md)).
2. Done (2026-10-15): this repository's `.dd/` migrated and curated against the v2 code (25 memories that
   described v1 archived, 22 rewritten with `not_derivable`, live globs, keyword phrases and two checks).
   Still to do: `v2` merged and released.
3. Real use on a project whose knowledge is not derivable by reading, then Codex verified live, then Grok
   Build (its payloads recorded first), then OpenCode.
