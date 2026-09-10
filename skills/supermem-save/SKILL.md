---
name: supermem-save
description: Explicitly save a user-stated memory through SuperMem admission. Use when the user says remember, save this decision, or never do X again.
---

# supermem-save

Turn the user's statement into a `supermem_propose` payload. Do not write files yourself.

Map:

- "remember we decided X" → `memory_type: decision`
- "never do X" / "don't repeat X" → `memory_type: anti_memory` with preventive `behavior_delta`
- "next time do X" → `memory_type: lesson` or `procedure`

Always include trigger, behavior_delta, evidence (`source_type: user_approval`), and micro+short forms. Then tell the user the admission decision and that they can edit it in the audit UI (`supermem_ui`).
