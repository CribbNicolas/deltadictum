---
name: compact
description: Find DD memories that overlap or repeat each other and file merge or retopic actions. Use for /dd:compact.
---

# Compact DD knowledge

1. Page through `list` for active, contested, superseded and legacy memories.
2. For each one, call `similar` with its id. Treat as a cluster the memories that say the same thing or whose scopes nest; sharing a topic area alone is not enough.
3. For each cluster worth merging, file one `act` of kind `merge` with the cluster ids as `targets` and a `result` proposal that keeps every valid trigger, the widest scope that still holds, and the evidence of all sources. Sources move one step down: active to superseded, superseded or legacy to archived. Never merge legacy with current memories; a cluster of legacy memories becomes one legacy memory and needs `legacy_reason`.
4. File an `act` of kind `retopic` for a memory filed under a misleading topic.
5. Tell the user which clusters you did not merge and why.

Every action waits for the user in the audit UI. End with the number of actions filed and the address from `ui`.
