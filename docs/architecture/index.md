---
title: Architecture
nav_order: 7
has_children: true
---

# Architecture

For readers who want to know why DD is built this way, or who want to change it.

- [Behavioural contract](../DD.md): what the code guarantees today. Where it and `src/` disagree, the code wins and the document is fixed.
- [Plugin constraints](plugin-constraints.md): seven limits a plugin for coding-agent harnesses lives inside. A proposal that fails one is rejected on that basis alone.
- [Invariants](invariants.md): properties that must never break, and what enforces each.
- [Where DD came from](history.md): what v1 was, what measurement showed, and the mistakes v2 must not repeat.
