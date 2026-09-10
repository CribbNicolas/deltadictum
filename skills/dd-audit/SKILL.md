---
name: dd-audit
description: Open or summarize the DeltaDictum audit UI so a human can list, edit, admit, or delete lessons.
---

# dd-audit

1. Call `status` and `list`.
2. Call `ui` and give the user the localhost URL as `DD - Audit UI: <url>`.
3. For edits/deletes the user requests, use `update`, `admit`, `reject`, or `delete` (canonical delete needs `confirm: true`).

Do not write SuperMem or DeltaDictum in chat. Use `DD - `.
