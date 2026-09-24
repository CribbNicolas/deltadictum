---
name: prospect
description: Search one area of the project for knowledge worth saving in DD, without repeating what is stored. Use for /dd:prospect followed by the area or question to explore.
---

# Prospect for DD knowledge

Arguments: the area, topic or question to explore.

1. Explore that area: its code, tests, docs and recent history (`git log` on the paths involved).
2. For each candidate lesson, decision, procedure or trap, call `similar` with its text and `retrieve` with the action it applies to.
3. If an existing memory already says it, skip it. If one says it partly or less accurately, `propose` with that memory's `topic_key` to revise it. Otherwise `propose` a new memory.
4. Keep only what an agent reading the code would miss: why not the obvious approach, traps, values that look valid but are not, steps nothing enforces. Cite file evidence.

End with what you filed, what you skipped as already known, and the address from `ui`.
