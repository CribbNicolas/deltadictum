---
name: supermem-audit
description: Open or summarize the SuperMem audit UI so a human can list, edit, admit, or delete memories.
---

# supermem-audit

1. Call `supermem_status` and `supermem_list`.
2. Call `supermem_ui` and give the user the localhost URL.
3. For edits/deletes the user requests, use `supermem_update`, `supermem_admit`, `supermem_reject`, or `supermem_delete` (canonical delete needs `confirm: true`).
