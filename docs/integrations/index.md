---
title: Harnesses
nav_order: 5
has_children: true
---

# Harnesses

Claude Code is supported in full and is where DD is measured. The others are added one at a time, each
verified against a recorded session before it is called supported.

| Harness | Status |
|---|---|
| Claude Code | Supported and measured |
| [Codex](codex.md) | Adapter written and unit-tested against recorded payloads; not yet verified in a live session |
| [OpenCode](opencode.md) | Adapter written (memories arrive with the tool result); not yet verified in a live session |
| [Grok Build](grok-build.md) | Registers Claude Code's hooks; its payload shapes are not yet verified |

The memory store is the same for every harness: a project's `.dd/memories/` serves them all.
