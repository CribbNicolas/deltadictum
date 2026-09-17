---
name: dd-save
description: Propose reusable project decisions or lessons when the user asks to remember something or a completed task produces evidence-backed learning.
---

# Save useful project knowledge

Select independent lessons with a future behavioral consequence. Capture supported knowledge at meaningful checkpoints; there is no proposal count limit per call or session. For large transfers, split calls when useful for managing context. A session without reusable learning needs no write.

Call `propose` with a `proposals` array and the host `session_id`. Each item contains:

- `topic_key`: stable domain/area/topic; reuse it to propose a revision.
- `trigger`: when this becomes relevant.
- `behavior_delta`: what to do.
- `why`: why the evidence supports it.
- `evidence_refs`: source_type, source_ref and summary.
- `capture_origin`: `user_explicit` when the user explicitly asked to save this knowledge; otherwise `model_initiated`.

Use `decision` for an explicit project choice and `lesson` for a learned pattern. Add `applies_to`, `assumptions`, `revisit_when` and discarded `alternatives` when they define the limits of the advice. A one-off successful fix does not establish a universal rule.

A user-requested development task or project choice is not itself a request to store memory. Classify each proposal separately, even in a mixed batch. Capture origin is independent of approval and authority; DD records the capture channel.

DD defaults missing origins to `user_explicit` for compatibility. Always send `capture_origin` explicitly so autonomous captures are classified correctly.

Reference actual project files or host observation IDs. Describe user statements accurately; never label an inferred conclusion as user approval. Do not submit chat transcripts, full logs, code dumps or hand-authored compact forms.

Report the returned pending-review status. `ui` provides the local review surface; proposing a replacement preserves the current decision until review.
