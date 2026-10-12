---
name: save
description: Save project knowledge an agent could not get from the code, when the user asks or a fix taught it.
---

# Save project knowledge

Write one JSON file per memory into `.dd/inbox/` (any name ending in `.json`). DD validates it at once and
answers in the same turn: stored (as a candidate, or active when DD verified its evidence), or rejected
with reasons; fix the file and write it again.

Fields: `topic` (two to four lowercase segments, `area/subject`), `kind` (`decision`, `trap`,
`failed_approach`, `fact` or `procedure`), `title`, `body` (what to do and why, naming the files, symbols,
commands or values it is about; at most 1,500 characters), `not_derivable` (one line: why reading the
code, tests and docs would not reveal this), `triggers` (clauses such as
`{ "on": ["edit"], "paths": ["src/store/*.js"], "symbols": ["openStore"] }`; omit them to use the ones DD
suggests from this session) and `evidence` (`{ "type": "file", "path": "src/x.js" }`, or an observation or
correction id DD gave you). When the user asked to save it, add `"origin": "user_explicit"`.
Save only what changes what a capable agent would do.
