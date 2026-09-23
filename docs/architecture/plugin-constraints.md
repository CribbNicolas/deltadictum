---
artifact_class: authored
owner_domain: architecture
artifact_type: reference
stability: stable
last_validated: 2026-09-17
used_by:
  - DD.md
  - architecture/project-cognition.md
  - memory/roadmap.md
do_not_co_load_with: []
---

# Plugin constraints

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**

This is the governing constraint of the project. It is not a phase, a deployment choice or a temporary
limitation to be lifted later. A design that needs a server, a database engine, a model runtime or a
background worker is not a smaller version of DD: it is a different product.

Every proposal is measured against the seven limits below before its merits are discussed. A proposal
that fails one of them is rejected on that basis alone, however good the idea is.

## The seven limits

### L1 — Hooks are ephemeral processes

One Node process is spawned per hook event (`hooks/run.cjs` → `src/hooks/run.js`). `PreToolUse` runs on
**every tool call** the host makes; its declared timeout is 10 s but the real cost is dominated by Node
start-up, not by the work.

Forbidden: loading a model, an index or any warm state on the hot path. Amortising a cost "after the
first call" does not work, because there is no second call in the same process.

### L2 — DD requires its resident process; without it DD is inactive, never blocking

One resident process per machine, shared by every project and session, holds the embedding model and
answers hooks and the audit UI for each project from that project's own store (`src/resident.js`,
`src/ui/server.js`). The first session or MCP server that finds none starts it; it is found through
`~/.dd-data/resident.json`. Revised 2026-09-23: embeddings are required, so until the resident answers
with its model loaded, DD is inactive — hooks inject nothing and SessionStart tells the person why and how
to fix it. The earlier wording (2026-09-22) fell back to lexical retrieval.

Hooks reach it over HTTP on `127.0.0.1` with a 250 ms timeout for `pre-tool` and 1500 ms otherwise
(`src/hooks/bridge.js`), and accept an answer only from a resident running the same source tree whose code
has not changed since it started.

Forbidden: a hook that blocks, errors or answers wrongly because the resident is missing (L5). Missing
means inactive and said so, nothing more. `DD_RETRIEVAL=lexical` exists only for tests and evaluation.

### L3 — Three required dependencies, one of them a local model runtime

`@modelcontextprotocol/sdk`, `zod` and `@huggingface/transformers` (ONNX, `Xenova/multilingual-e5-small`),
on Node ≥ 22 (`package.json`). The model is loaded only by the resident process (L2), once per machine,
never on the hot path (L1): a cached model takes about 0.5 s to load.

Revised 2026-09-22 and 2026-09-23. The earlier text forbade local embeddings outright, because
embeddings were assumed to be a separate service; an in-process runtime is a package, not a service.
Still forbidden: a hosted or remote model, an inference server, a GPU requirement.

### L4 — The hook contract differs per harness

Codex rejects `decision: 'allow'` and requires `decision: 'block'` to inject context at `Stop`
(`src/hooks/run.js`). What is a veto in one harness may not exist in another.

Consequence: any capability beyond "return advisory context" is negotiated per harness and must
degrade — a veto becomes a warning where vetoes are unavailable. It is never assumed.

### L5 — Failures must not block the host

Stated in `hooks/hooks.json`. A hook that throws, hangs or returns malformed output damages the user's
session in a way no memory benefit repays.

Consequence: every new gate needs a defined failure direction, and the default is to stay out of the way.

### L6 — Single-developer data volumes

Telemetry retention is 90 days or **2000 rows**, whichever comes first (`src/store/paths.js`).

Forbidden as a requirement: contextual bandits, reinforcement learning, per-condition conformal
calibration, Shapley attribution — anything needing thousands of labelled events per arm or per
stratum. The data does not exist and will not accumulate. Methods that work from tens of observations,
or that need no observations at all, are the ones available.

### L7 — Local-first, no external telemetry

The store is git plus a derived SQLite index. Nothing leaves the machine.

Forbidden: any mechanism that needs aggregation across users, a shared model, or a hosted service.

## What this rules out permanently

- PostgreSQL, Qdrant, any external database or vector store.
- An inference server, a GPU requirement, a hosted or remote model.
- Federation, multi-tenancy, RBAC, organisation-level vaults.
- Background conservation workers and scheduled jobs. (A resident process for retrieval is allowed, L2.)
- Importance scores or rankings learned online from user traffic.

Documents describing these have been removed rather than left as aspiration, because an unreachable roadmap misleads every reader and every agent that loads it.

## What to change so DD works better as a plugin

These are the directions the constraints open rather than close. Each is tracked in
[the roadmap](../memory/roadmap.md).

| Direction | Why the plugin shape favours it |
|---|---|
| Make lexical and structural matching carry more weight — trigger variants, alias expansion, concept grouping, near-duplicate suppression | L3 removes the dense arm, so the signals that remain have to be sharper. They are also deterministic, auditable and free at the hot path |
| Move cost off the hot path and into review time | L1 charges per tool call; the audit UI (L2) is where an expensive computation is affordable and where a human is present anyway |
| Evaluate offline against recorded decisions rather than learning online | L6 forbids online policies, but the recorded events are enough to *compare* two deterministic rankings |
| Prefer provenance and structure over statistics | Source reliability, scope, evidence and authority are available on the first observation; statistical signal needs volume DD will never have |
| Treat every capability beyond advisory context as negotiated per harness | L4 makes portability a design input, not an afterthought |
| Keep the human in the write path and spend the effort on making review fast | Review is the scarce resource, so the throughput problem is queue ordering and merge quality, not model capability |

## Relation to the rest of the documentation

`DD.md` states the current behavioural contract. `architecture/project-cognition.md` describes the
implemented architecture. `architecture/invariants.md` lists the invariants. This document states the
boundary all of them operate inside.
