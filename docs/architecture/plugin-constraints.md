---
title: Plugin constraints
parent: Architecture
nav_order: 2
artifact_class: authored
owner_domain: architecture
artifact_type: reference
stability: stable
last_validated: 2026-10-13
used_by:
  - DD.md
  - CLAUDE.md
do_not_co_load_with: []
---

# Plugin constraints

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**

This is the governing constraint of the project. A design that needs a server, a database engine, a model
runtime or a background worker is not a smaller version of DD: it is a different product.

Every proposal is measured against the seven limits below before its merits are discussed. A proposal that
fails one of them is rejected on that basis alone. v2 rewrote several of them (no resident process, no model,
no dependency); each is stated here as the code holds it today.

## The seven limits

### L1 — Hooks are ephemeral processes

Every hook is a new Node process, and `PreToolUse` runs on every tool call. Its cost is dominated by Node's
start-up, so the hot path (`hooks/run.cjs`, `src/hooks/v2/*.cjs`, `src/engine/*.cjs`) is CommonJS and loads
lazily: a project without a compiled index loads no matching code, and a tool call where nothing fires loads
only the matcher. Measure a ranking or matching change on that path, not in a microbenchmark.

### L2 — No resident process

DD runs inside the hook process, in a maintenance process session start detaches at most once a day, and in the
review UI a person starts with `deltadictum ui`. None of them is required for delivery; nothing waits for any of
them.

### L3 — No runtime dependency

DD needs Node.js 22.16 or later and nothing else. `node:sqlite` with FTS5 holds local telemetry and the
similarity index, off the hot path. There is no embedding model and no vector store: memories fire by rule
matching over the compiled index.

### L4 — The hook contract differs per harness

Claude Code, Codex, OpenCode and Grok Build send different payloads and accept different answers. An adapter
translates a harness's events and output format into DD's events (`src/hooks/v2/events.cjs`,
`src/hooks/v2/codex.cjs`, `adapters/opencode/`); the matcher, ledger, checks and capture are shared. A capability
one harness lacks (OpenCode has no hook that adds context before a tool runs, nor a Stop hook) is not emulated.

### L5 — Failures must not block the host

A hook that fails for any reason, including a module that does not load, ends with exit 0 and no output.

### L6 — Single-developer data volumes

DD sees one developer's sessions: a handful a day, session files kept seven days, counters rolled up after that.
No policy is learned online. Thresholds are counted rules (a memory unused in 20 sessions that touched its paths
is retired), not statistics.

### L7 — Local-first, nothing leaves the machine

Memories are files in the project's git repository; everything derived lives in `.dd/local/`, git-ignored.
DD makes no network request, and the review UI listens on a loopback port only.

## What this rules out

- PostgreSQL, Qdrant, any external database or vector store.
- An inference server, a GPU requirement, a hosted or remote model.
- Federation, multi-tenancy, RBAC, organisation-level vaults.
- A process every project must keep running.
- Importance scores or rankings learned online from user traffic.

## Relation to the rest of the documentation

`DD.md` states the current behavioural contract. `invariants.md` lists the properties that must never break.
This document states the boundary all of them operate inside.
