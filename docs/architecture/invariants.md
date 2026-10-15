---
title: Invariants
parent: Architecture
nav_order: 3
---

# Invariants

Properties that must remain true at all times. Violating one is a system-level failure, not a regression to be
traded off. Each names what enforces it in v2; where this file and `src/` disagree, the code is what DD does
and this file is corrected.

## INV-01: Project isolation is mandatory

A project's knowledge lives in its own `.dd/` and reaches no other project. The project root is resolved from
the folder the harness reports (`findProjectRoot` in `src/engine/locate.cjs`), and evidence and trigger paths
are repository-relative paths that cannot leave it (`validRelativePath` in `src/memory/schema.js`).

## INV-02: Delivery and recall are project-scoped

A hook matches events against the project's own compiled index; `recall` searches the project's own similarity
index. There is no global search and no cross-project fallback.

## INV-03: Memory is not chat history

A memory is knowledge an agent cannot derive from the code: it states why (`not_derivable`), when it applies
(triggers) and on what evidence. Ingestion refuses generic advice, and the footprint keeps no prompt text
beyond a short preview of a detected correction.

## INV-04: Model output never mutates state on its own authority

The agent proposes through `.dd/inbox/`; deterministic code validates and writes. A proposal becomes a
candidate, and it activates without a person only by auto-accept, which rests on evidence DD verified itself (a
file it hashed, a correction it recorded), never on a field the model supplied or a success it reported
(`src/capture/auto-accept.js`). The agent's requests to archive or revise wait for a person. Everything else
that changes a memory's status happens in the review UI, by a person.

## INV-05: Evidence establishes integrity, not support

A verified reference means the file existed with the bytes DD hashed; a changed hash marks the memory's
evidence stale. It never means the memory's claim follows from it.

## INV-06: One live memory per topic

At most one memory per topic is `active` or `contested`. A revision supersedes the memory it replaces in the
same commit; it never silently coexists.

**Enforced by:** `commit` in `src/memory/store.js` refuses a write that would leave two live memories on a topic
it makes live (`live_topic_conflict`); a conflict a git merge brings in is reported by `conflicts()` and blocks
writes to that topic only.

## INV-07: Delivered knowledge is advisory

Delivered memories are content, never commands, and never outrank the host's instructions, the user's intent or
the current code. On OpenCode, where the text travels inside a tool result, it is framed as such
(`adapters/opencode/frame.js`).

## INV-08: The host is never blocked

A hook that fails, times out or meets malformed input ends silently with exit 0 (`hooks/run.cjs`). No memory
benefit justifies damaging the session it runs in.

## INV-09: Archiving is not deleting

Retirement and archiving keep the memory's file; a person restores it in the review UI. Deletion happens only
in the review UI, confirmed by the person; no automatic path reaches it. Retirement by disuse never touches a
memory a person reviewed, nor one a pending candidate revises (`src/maintenance/retire.js`).

## INV-10: Git is the authority; `.dd/local/` is derived

Memories are git-tracked files under `.dd/memories/`. The compiled index, session files and telemetry under
`.dd/local/` are git-ignored and rebuildable or disposable: losing them never loses knowledge.

## Authority resolution order

When artifacts define overlapping constraints, resolve in this order:

1. **Plugin constraints** (`plugin-constraints.md`) — the boundary everything operates inside
2. **Invariants** (this file) — non-negotiable
3. **Current contract** (`../DD.md`) — the behaviour DD guarantees today
4. **Reference** — the remaining documents under `docs/`

Conflicts are resolved in favour of the higher authority.
