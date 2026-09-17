---
artifact_class: authored
owner_domain: memory
artifact_type: architecture
stability: draft
last_validated: 2026-09-17
depends_on:
  - architecture/plugin-constraints.md
used_by:
  - memory/memory-admission-control.md
  - memory/roadmap.md
do_not_co_load_with: []
---

# Behavioral Memory Architecture

Summary: DD stores operational behavior change, not raw events or generic summaries.

> Scope: DD is a harness plugin. Everything here operates inside
> [the plugin constraints](../architecture/plugin-constraints.md); a design that needs a service,
> a database engine, a model runtime or a background worker is out of scope by definition.

## Core Model

Memory is a governance layer over future behavior. A durable memory is accepted only when it can
improve a future agent's action, safety, speed, cost, abstention, or consistency.

The golden rule is:

```text
Do not store what happened.
Store what should change next time because it happened.
```

## Required Semantics

Every durable memory must include:

- `trigger`: when the memory becomes relevant.
- `behavior_delta`: what future agents should do differently.
- `evidence_refs`: why the memory is justified.

## AI/System Boundary

LLMs may propose meaning. Deterministic policy governs state.

LLMs may propose extraction, classification, summaries, topic keys, relation candidates, contradiction
candidates, and retrieval intent. Deterministic code validates schemas, permissions, scope, lifecycle
transitions, admission thresholds, durable writes, mutation, deletion, and final context injection.

Model output never mutates memory directly. A proposal is validated and committed by deterministic
code, or it is refused.

## Autonomy Levels

| Level | Behavior |
|---|---|
| Level 1 | Automatic safe actions: record observations, sanitize, reject invalid memory, ignore exact duplicates, return compact forms. |
| Level 2 | Model proposal under deterministic validation: lessons, anti-memories, topic keys, relations, compact forms. |
| Level 3 | Requires local human review: promote a candidate, delete canonical memory, resolve a contradiction. |

Level 3 is not a maturity stage to be automated away later. It is the property that makes the rest
safe, and it is what a reported success can never bypass.

## Non-Goals

Memory is not chat history. Memory is not raw model output. Memory is not a vector-store dump. Memory
is not allowed to rewrite canonical project history without deterministic policy or human review.

## Why Behavioral, Not Archival

Agents exhibit experience-following: when they retrieve similar past experiences, they tend to repeat
similar outputs. Stored raw, a single bad experience propagates as misaligned replay. Behavioral memory
counters this by storing the corrected behavior delta, and by allowing anti-memories to block a pattern
rather than merely recall it.

## Cognitive-Architecture Framing

Classical cognitive architectures (Soar, ACT-R) separate semantic, episodic and procedural memory, and
let activation by frequency and recency influence retrieval. DD mirrors this: `claim`/`decision` are
semantic, `observation` is episodic evidence, and `procedure` is procedural. The distinction matters
because each is admitted, retrieved and retired differently.

Frequency and recency are available cheaply — DD records a use count and a creation time — and are used
to separate live knowledge from knowledge nothing has activated. They are ranking signals, never
evidence of correctness.

## Pipeline

```text
tool events and user corrections
  -> sanitizer and observation log        (deterministic, Level 1)
  -> proposal                             (model, Level 2)
  -> admission gate                       (deterministic, Level 2)
  -> candidate
  -> local human review                   (Level 3)
  -> active knowledge, one live memory per topic key
  -> trigger + scope + budget retrieval   (deterministic, Level 1)
  -> outcome reports                      (telemetry only; never promotion)
```

Each stage is a pure step over local state. There is no queue, no worker and no service between them:
the whole pipeline runs inside a hook process, an MCP call or the local audit UI.

## Research Lineage

This documentation set absorbs the following prior art so the archived reports are not required
reading. Read it for the ideas, not for the deployments: most of these systems are services, and the
parts that assume a server, a vector index or a hosted model do not transfer to a plugin.

- **Generative Agents** — observation / reflection / planning triad over a natural-language memory stream.
- **MemGPT** — OS-style tiered memory with movement between fast and slow context.
- **A-MEM** — Zettelkasten-style linked notes that update historical representations.
- **Mem0** — extraction, consolidation and retrieval, with a graph variant.
- **Letta / MemFS** — always-visible core memory blocks; git-backed versioned memory with conflict resolution.
- **Zep / Graphiti** — bi-temporal fact validity, where a contradicting fact invalidates rather than deletes.

The consistent lesson that does transfer: structure, hierarchy and consolidation beat plain top-k
retrieval when long-term stability matters. The lesson that does not transfer is the infrastructure
each of them assumes.
