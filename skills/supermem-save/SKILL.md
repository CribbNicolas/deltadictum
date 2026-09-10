---
name: supermem-save
description: Save a durable SuperMem memory through admission. Use when the user says remember, and also at session end if exactly one reusable lesson exists.
---

# supermem-save

Turn a reusable lesson into a `supermem_propose` payload. Do not write files yourself.

Use this when the user says remember **and** at session Stop if the session produced exactly one reusable lesson, anti-memory, or decision. If nothing should change next time, do not propose. Never dump the transcript.

Map:

- "remember we decided X" → `memory_type: decision`
- "never do X" / "don't repeat X" → `memory_type: anti_memory` with preventive `behavior_delta`
- "next time do X" → `memory_type: lesson` or `procedure`

Always include trigger, behavior_delta, evidence (`source_type: user_approval`), and micro+short forms. Then tell the user the admission decision and that they can edit it in the audit UI (`supermem_ui`).
