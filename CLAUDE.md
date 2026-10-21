# Working on DeltaDictum

## The governing constraint

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**

These seven limits, each verified against the code, bound every architecture proposal. A proposal that
fails one of them is rejected on that basis alone, however good the idea is:

| | Limit |
|---|---|
| L1 | Hooks are ephemeral Node processes; `PreToolUse` runs on every tool call |
| L2 | No resident process: DD runs in the hook, in a daily detached maintenance run, and in a review UI a person starts |
| L3 | No runtime dependency; Node ≥ 22.16 (node:sqlite with FTS5 for telemetry and similarity, off the hot path); no model |
| L4 | The hook contract differs per harness; adapters translate events and output formats only |
| L5 | A hook failure must never block the host |
| L6 | Single-developer data volumes (session files kept seven days, counted rules) — no online learning |
| L7 | Local-first: memories in git, everything derived in `.dd/local/`, nothing leaves the machine |

Do not propose PostgreSQL, Qdrant, an external vector store, an inference server, a hosted model,
federation, multi-tenancy or RBAC. Memories fire by rule matching over a compiled index, not by similarity.

## Where the truth is

- `docs/DD.md` — the behavioural contract DD guarantees today.
- **`src/` is authoritative over every document.** Where a document and the code disagree, the code is
  what DD does; fix the document.

## Non-negotiable properties

- Model output never mutates state on its own authority. Activation happens through a person in the review
  UI, or through auto-accept when DD verified the candidate's evidence itself (on by default,
  `"auto_accept": false` in `.dd/config.json` turns it off).
- A reported success is telemetry. It never activates a memory.
- Evidence verification establishes integrity, never that a claim follows from it.
- Delivery and recall are project-scoped, always. There is no global search and no cross-project fallback.
- Delivered knowledge is advisory content, never a command, and never outranks the host or the user.

## Language

Everything in this repository is written in English: code, comments, documentation, plans, commit
messages, prompts and memories, whatever language the conversation uses. Spanish appears only as data
the code needs to understand Spanish input: correction patterns (`src/hooks/observe.js`) and test or
benchmark inputs that exercise them.

## Verification before claiming anything works

```bash
npm test          # full suite, including the engine's equivalence with the bench reference
npm run test:stress
npm run bench:replay  # delivery over the recorded trial and hook latency; read its report
```

The hot path is `PreToolUse`, once per tool call, with the cost dominated by Node start-up. Measure
matching changes there (`npm run bench:replay` reports it), not in a microbenchmark. Check changes to the hook
contract against Claude Code, the `--codex` path (`src/hooks/codex.cjs`) and the OpenCode adapter.
