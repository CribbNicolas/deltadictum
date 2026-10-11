---
name: save
description: Save project knowledge an agent could not get from the code, when the user asks or a fix taught it.
---

# Save project knowledge

Write one JSON file per memory into `.dd/inbox/` (any file name ending in `.json`). DD validates it at once
and answers in the same turn: stored as a candidate, or rejected with reasons to fix.

Required fields: `topic` (two to four lowercase segments, `area/subject`), `kind` (`decision`, `trap`,
`failed_approach`, `fact` or `procedure`), `title`, `body` (what to do and why, at most 1,500 characters),
`not_derivable` (one line: why reading the code, tests and docs would not reveal this), `triggers` (clauses
such as `{ "on": ["edit"], "paths": ["src/store/*.js"], "symbols": ["openStore"] }`) and `evidence`
(files, observations or corrections). Save only what changes what a capable agent would do.
