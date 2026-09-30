---
name: save
description: Propose reusable project decisions or lessons when the user asks to remember something or a completed task produces evidence-backed learning.
---

# Save useful project knowledge

Select independent lessons with a future behavioral consequence. Capture supported knowledge at meaningful checkpoints; there is no proposal count limit per call or session. For large transfers, split calls when useful for managing context. A session without reusable learning needs no write.

Call `propose` with a `proposals` array and the host `session_id`. Each item contains:

- `topic_key`: stable domain/area/topic; reuse it to propose a revision.
- `trigger`: when this becomes relevant.
- `behavior_delta`: what to do. Open with the action in one sentence under 200 characters: when a pack is full the memory arrives as that sentence alone, a headline with its id. Put the story (what broke, how it was found) in `why`, not first.
- `why`: why the evidence supports it.
- `evidence_refs`: source_type, source_ref and summary.
- `anchors`: `keywords` (2-16) whose presence in a request means the memory applies, and optional `not_when` phrases that mean it does not. They decide delivery, so choose them with care.
- `capture_origin`: `user_explicit` when the user explicitly asked to save this knowledge; otherwise `model_initiated`.

Before proposing, ask whether an agent reading the code, tests and docs would work it out on its own. If it would, do not propose: that memory costs context and adds nothing. Worth keeping is what the code does not show: why the obvious approach is wrong, traps and pitfalls, values that look valid but are not, steps nothing enforces.

Write `trigger`, `behavior_delta` and `why` in English whatever the conversation language; other languages are refused.

Anchors are how the memory is found, and only an anchor pushes it. Pick the specific words someone uses when this applies: domain terms, component or feature names, commands, error text (`endurance`, `inventory grid`, `npm publish`, `EOTP`). Each keyword must appear in the memory's own title, trigger, `trigger_variants`, `behavior_delta` or scope. When the user writes in another language, add a `trigger_variant` in that language and anchor on its words too (`resistencia` beside `endurance`). Never anchor on function words or lone generic terms (code, fix, test, plan, cambiar); DD refuses them, and any keyword that fires on an acknowledgement or an unrelated question. Use `not_when` for the nearby cases where the words appear but the advice does not apply.

Write 3-6 `trigger_variants` as the requests someone would make when the memory applies, in English and in the language the user writes in ("add a hunger rule that lowers endurance", and the same request as the user would write it in their language). They are indexed and embedded with the memory, so a request phrased like them finds it (document expansion); anchor keywords can then come from them.

To anchor a memory that already exists (the `health` tool lists the ones without anchors), file an `act` action of kind `anchor` with its id, the `anchors`, and any `trigger_variants` needed to ground a keyword in the user's language. Anchors change only when a memory is delivered, so a valid anchor action applies itself unless the project turned that off; the result says whether it was applied or waits for the user in the audit UI.

Use `decision` for an explicit project choice and `lesson` for a learned pattern. Add `applies_to`, `assumptions`, `revisit_when` and discarded `alternatives` when they define the limits of the advice. Scope `applies_to.files` to the files the advice is about; a project-wide glob such as `src/**` admits the memory everywhere but never activates it by itself. A one-off successful fix does not establish a universal rule.

A user-requested development task or project choice is not itself a request to store memory. Classify each proposal separately, even in a mixed batch. Capture origin is independent of approval and authority; DD records the capture channel.

A proposal without `capture_origin` is recorded as `user_explicit`. Always send it explicitly so autonomous captures are classified correctly.

Reference actual project files or host observation IDs. Describe user statements accurately; never label an inferred conclusion as user approval. Do not submit chat transcripts, full logs, code dumps or hand-authored compact forms.

Report the returned pending-review status. `ui` provides the local review surface; proposing a replacement preserves the current decision until review.
