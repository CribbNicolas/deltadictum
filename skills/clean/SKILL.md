---
name: clean
description: Review archived DD memories and file restore and delete actions. Use for /dd:clean, or when DD says the archive passed its review threshold.
---

# Clean the DD archive

1. Call `list` with `lifecycle_state: archived`, and `get` each memory for its `archived_reason`.
2. Decide per memory: still useful for current work (restore) or not (delete). A memory archived as "merged into <id>" stays deleted unless the merge result lost something it said.
3. File at most one `act` of kind `restore` and one of kind `delete`, each listing its ids, with a rationale that names the rule you applied. Restore fails for a memory whose topic another memory now holds; name those to the user instead of filing them.
4. Show the user both lists before you end.

Deletion is permanent once the user applies it in the audit UI. End with the address from `ui`.
