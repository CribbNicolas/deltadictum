# Memories

A DD memory is conditional engineering advice: **when** it applies (`trigger`), **what to do** differently
(`behavior_delta`), **why**, and the **evidence** behind it. It is not a session log or a transcript, and it
does not restate what the code already shows. A memory is worth keeping when an agent reading the code,
tests and docs would miss it. Typical examples:

- why the obvious approach is wrong here;
- a trap, or a value that looks valid but is not;
- a step that nothing in the code enforces.

## Types

Every memory has one of five types. The type tells the agent and the reviewer what kind of advice it is.
It does not change how the memory is ranked.

| Type | Use it for | Example `behavior_delta` |
|---|---|---|
| `lesson` (default) | A pattern learned from work: something that broke or surprised, and what to do next time | "Close stores in `t.after` so a failing assertion cannot leave a SQLite handle open." |
| `decision` | An explicit project choice, with the alternatives it beat | "Reuse the original idempotency key when retrying a payment." |
| `anti_memory` | A practice that must not be done. Its `behavior_delta` must be preventive (*do not*, *never*, *avoid*, *must not*…); DD refuses one that is not. It is labelled `ANTI` | "Never log the raw authentication header, even at debug level." |
| `procedure` | Steps to follow, in order, for a recurring task | "Export Windows first, then Android; the Android export reads the Windows build's version file." |
| `claim` | A fact about the project or its environment that the code does not show | "The staging database is restored from production every Monday at 06:00 UTC." |

## Fields

The agent writes a memory through the `propose` MCP tool. DD derives the title, the compact forms the
agent receives, the confidence and the evidence hashes; nothing derived is accepted from the agent.

| Field | Required | Meaning |
|---|---|---|
| `topic_key` | yes | 2 to 4 lowercase segments joined by `/` (`payments/retry/idempotency`). Proposing on an existing key requests a revision of that memory. |
| `trigger` | yes | When the advice applies, as a situation ("when retrying payment requests"). |
| `behavior_delta` | yes | What to do. Opens with the action in one sentence: when a pack is full, that sentence alone is what the agent receives. |
| `why` | yes | Why the evidence supports it: what broke, how it was found. |
| `evidence_refs` | yes | 1 to 12 references (`file`, `diff`, `test_log`, `tool_output`, `user_statement`, …) with a summary. DD hashes the ones it can verify. |
| `anchors` | yes | `keywords` (2 to 16 words or short phrases) whose presence in a request means the memory applies, optional `not_when` phrases, and optional `files` whose every read or edit needs it. Each keyword must appear in the memory's own text. |
| `memory_type` | no | One of the five types; `lesson` when omitted. |
| `capture_origin` | no | `user_explicit` when the user asked to save it, `model_initiated` when the agent found it. Recorded as `user_explicit` when omitted. It is not approval. |
| `trigger_variants` | no | Up to 8 requests someone would make when it applies, including in the user's language. Indexed and embedded with the memory. |
| `applies_to` | no | `files`, `components` and `operations` the advice is limited to. |
| `assumptions` | no | Conditions the advice depends on. A project fact that contradicts one withholds the memory. |
| `revisit_when` | no | When to review it again: a file changing, a fact changing, a date, or manual. |
| `alternatives` | no | Options considered and why they lost. |
| `scope` | no | `project` (default), `user`, `agent`, `workflow`, `file` or `service`. |
| `tags` | no | `ambient` marks project-wide knowledge (architecture, conventions) that is sent once at every session start. |

`trigger`, `behavior_delta` and `why` are written in English whatever language the conversation uses.
DD refuses other languages, since memories are matched in English. A `trigger_variant` in the user's
language lets a request in that language find the memory.

A full example:

```json
{
  "session_id": "host-session-id",
  "proposals": [{
    "memory_type": "decision",
    "capture_origin": "model_initiated",
    "topic_key": "payments/retry/idempotency",
    "trigger": "when retrying payment requests",
    "behavior_delta": "Reuse the original idempotency key.",
    "why": "The provider may have accepted the first request before its response timed out.",
    "anchors": { "keywords": ["idempotency key", "payment retry"] },
    "applies_to": { "components": ["payments"] },
    "assumptions": [{ "key": "provider.idempotency", "equals": true,
      "description": "The provider supports idempotency keys." }],
    "revisit_when": [{ "kind": "file_changed", "path": "docs/payment-provider.md",
      "description": "The provider contract changes." }],
    "evidence_refs": [{ "source_type": "file", "source_ref": "docs/payment-provider.md",
      "summary": "Provider retry contract" }]
  }]
}
```

## Lifecycle

Every proposal starts as a **candidate** and reaches the agent only once it is admitted. A person admits
it in the audit UI, or [auto-accept](configuration.md#auto-accept-threshold-values) admits it when the
evidence DD verified is strong enough.

| State | Answers | Reaches the agent |
|---|---|---|
| `candidate` | What is pending review? | No |
| `active` | What do I do? | Yes |
| `contested` | What do I do, given two memories disagree? | Yes, flagged `DISPUTED` |
| `legacy` | What must not be done again? | Yes, flagged `LEGACY`, only when nothing current covers its topic |
| `superseded` | Where did this memory come from? | No; history for evolving it |
| `archived` | What stopped being useful? Restorable, with its reason | No |
| `rejected` | What was turned down? | No |

- **Revisions.** A pending revision never displaces the memory it revises. Approving it publishes the
  new version and archives the old one in a single step.
- **Sending back.** A reviewer can send a candidate back with a reason. The reason reaches the agent on its
  next prompt, and the candidate cannot be admitted until a corrected version answers it.
- **Store changes.** The agent asks for changes through **actions**: archive, restore, delete, legacy,
  merge, split, retopic, resolve and anchor. Each is a pending file in `.dd/actions/` until a person
  applies, rejects or sends it back. Actions are never auto-accepted. The one exception is `anchor`,
  which only adds retrieval metadata and applies itself (see `auto_apply_retrieval_metadata`).
- **Retirement.** A memory nothing activates is archived by disuse, never by age alone. This happens only
  when nobody reviewed it, its trigger had real chances to fire and never did, and it is past a minimum
  age.

## Authority and confidence

- **Authority** says who stands behind a memory:
  - `inferred`: a candidate;
  - `validated`: admitted;
  - `canonical`: a reviewer marked it as the project's standing rule.
- **Confidence** is capped by the most reliable evidence DD verified. From least to most reliable:
  1. an unverified agent claim;
  2. a recorded host observation;
  3. a repository artifact;
  4. an observed user correction.

  A proposal the agent made on its own initiative is scaled down. How often a memory is retrieved, and
  outcomes the agent reports, never raise either value.

## What the agent sees

Each delivered memory is one line headed by a flag and its id, so the agent can fetch the full rationale
with `get`:

| Flag | Meaning |
|---|---|
| `LESSON`, `DECISION`, `PROCEDURE`, `CLAIM`, `ANTI` | An effective memory of that type |
| `DISPUTED` | Two memories disagree; a person settles it in the audit UI |
| `LEGACY` | An abandoned practice, with why and what replaced it |
| `REVIEW REQUIRED` | Still delivered, with what to check first: `EVIDENCE CHANGED` when a file it cites changed since it was verified |

A memory whose assumption no longer holds, whose revisit date has passed or that has reported
counterevidence is withheld until a person reviews it.
