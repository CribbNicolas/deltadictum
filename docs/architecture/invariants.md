---
artifact_class: authored
owner_domain: architecture
artifact_type: reference
stability: stable
last_validated: 2026-09-17
depends_on:
  - architecture/plugin-constraints.md
do_not_co_load_with: []
---

# Invariants

Properties that must remain true at all times. Violating one is a system-level failure, not a
regression to be traded off.

> The earlier version of this file carried invariants about a llama.cpp inference service, a separate
> embedding service and a Docker Compose stack. DD is a harness plugin and has none of those; those
> invariants were removed rather than restated. See
> [plugin constraints](plugin-constraints.md).

## INV-01: Project isolation is mandatory

Every project has an isolated knowledge scope. Knowledge from one project must never reach another
project's retrieval. The project identifier is resolved from the repository and is the first filter on
every read and every write, not a field applied afterwards.

**Enforced by:** `project_id` on every store query; `validateExplicitContradiction` refuses a
cross-project pair; evidence paths are confined to the repository root.

## INV-02: Retrieval is project-scoped first

Retrieval never searches without a project filter. The order is fixed: project filter → lifecycle and
type filter → candidate generation → applicability gate → ranking → budgeted injection. There is no
global search and no cross-project fallback.

## INV-03: Memory is not chat history

Knowledge is conditional engineering guidance: when it applies, what to do differently, why, and on
what evidence. It is not a transcript, not raw model output, and not a dump of everything observed.

## INV-04: Model output never mutates state

A model proposes; deterministic code validates and commits. No MCP argument, no proposal field and no
reported outcome can set lifecycle state, authority, confidence or approval. Promotion happens only
through local human review.

**Enforced by:** `normalizeProposal` overwrites every epistemic field; `admitMemory` requires a
capability that no transport can construct; `recordOutcome` writes telemetry only.

## INV-05: Evidence establishes integrity, not support

A verified reference means the artifact exists and its bytes were checked. It never means the claim
follows from it. Only review establishes support.

## INV-06: One live memory per topic key

At most one memory per project and topic key is `active` or `contested`. A replacement supersedes;
it never silently coexists.

**Enforced by:** a unique partial index in the store, and a matching guard in the git file store.

## INV-07: Injected context is advisory and self-consistent

Retrieved knowledge is content, never a command, and can never raise its own priority above the host's
instructions or the user's intent. An injected pack never carries both sides of a known contradiction.

## INV-08: The host is never blocked

A hook that fails, times out or returns malformed output must degrade to silence. No memory benefit
justifies damaging the session it runs in.

## INV-09: Git is the authority, SQLite is derived

Knowledge lives in git-tracked files. The SQLite index is a rebuildable projection plus local
telemetry. Losing the index must never lose knowledge.

## Authority resolution order

When artifacts define overlapping constraints, resolve in this order:

1. **Plugin constraints** (`plugin-constraints.md`) — the boundary everything operates inside
2. **Invariants** (this file) — non-negotiable
3. **Current contract** (`../DD.md`) — the behaviour DD guarantees today
4. **Decisions** (`../decisions/`) — accepted architectural choices
5. **Reference and specs** — design records, historical unless marked implemented

Conflicts are resolved in favour of the higher authority.
