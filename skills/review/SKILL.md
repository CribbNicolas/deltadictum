---
name: review
description: Open DD's review UI for candidates and stale memories.
---

# Review DD knowledge

Run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" doctor` from the project first and tell the user its
`summary` line, with the `problems` it lists, if any. Then run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" ui`
from the project, in the background, and show the user the address it prints, on its own line and exactly
as printed: the `?key=` part is what lets the browser in. Candidates, stale memories, agent requests and
trigger health are reviewed there by a person.
