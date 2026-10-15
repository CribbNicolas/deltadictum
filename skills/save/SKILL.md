---
name: save
description: Save project knowledge an agent could not get from the code, when the user asks or a fix taught it.
---

# Save project knowledge

With the Write tool (on Codex, `apply_patch`), create one JSON file per memory in `.dd/inbox/` (any name
ending in `.json`; a file made through a shell command is not read). DD validates it at once and answers in the same turn: stored
(as a candidate, or active when DD verified its evidence), or rejected with reasons; fix the file and
write it again.

Fields: `topic` (two to four lowercase segments, `area/subject`), `kind` (`decision`, `trap`,
`failed_approach`, `fact` or `procedure`), `title`, `body` (what to do and why, naming the files, symbols,
commands or values it is about; at most 1,500 characters), `not_derivable` (one line: why reading the
code, tests and docs would not reveal this), `triggers` (clauses such as
`{ "on": ["edit"], "paths": ["src/store/*.js"], "symbols": ["openStore"] }`) and `evidence`: a repository
file `{ "type": "file", "path": "src/x.js" }`, an id DD gave you `{ "type": "observation", "ref": "e1a2b3c4" }`
or `{ "type": "correction", "ref": "..." }`, or `{ "type": "note", "summary": "..." }`. Without triggers,
DD uses the ones it suggested for the fix you cite. When the user asked to save it, add
`"origin": "user_explicit"`. Save only what changes what a capable agent would do.

To ask for a change to an existing memory instead, write `{ "request": "archive" | "revise",
"target": "<id or topic>", "why": "..." }`; it waits for a person in the review UI.

When you save or request several things at once, give them one `"batch": "<name>"` (letters, digits,
`-` or `_`, at most 64 characters, for example the task's name): the person accepts or rejects the
whole lot in one action in the review UI. Each item is still validated on its own; one that is refused
is reported and the others go through.
