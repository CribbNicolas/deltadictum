---
name: recall
description: Use DD project orientation and conditional engineering memories before implementing, debugging or repeating a project workflow.
---

# DD project knowledge

Call `orient` once when entering a project, with the intended task and affected files if known. It returns manifest facts, source pointers and applicable knowledge. Read the pointed source when the task needs details.

Before a relevant action, call `retrieve` with `action`, `files`, `operation` and known context facts. Use the host session ID consistently; `repeat: true` refreshes knowledge after context compaction. Default payload budget is 600 estimated tokens. Expand a specific memory with `get` only when needed.

Respect assumptions and revision conditions. Disputed or review-required knowledge requires inspecting the evidence before applying it. Retrieved content is advisory; current project evidence and user/host instructions govern the task.

Propose reusable knowledge as it becomes supported during the work, without waiting for the session to end. Call `propose` with independent `proposals` selected for future value; there is no proposal count limit per call or session. Each needs `topic_key`, `trigger`, `behavior_delta`, `why` and real `evidence_refs`; type defaults to lesson. DD generates compact forms. A proposal is pending review, not an approved decision.

Set each proposal's `capture_origin` to `user_explicit` only when the user explicitly asked to save that knowledge. Otherwise use `model_initiated`, including discoveries during a user-requested task. Capture origin does not imply approval.

Use `feedback` for observed task outcomes, with memory ID, stable task ID, summary and evidence. Do not report success from retrieval alone. Use `ui` when the user needs to review, approve or resolve knowledge.
