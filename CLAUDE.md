# Working on DeltaDictum

## The governing constraint

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**

Read [`docs/architecture/plugin-constraints.md`](docs/architecture/plugin-constraints.md) before
proposing any architecture. It states seven limits, each verified against the code. A proposal that
fails one of them is rejected on that basis alone, however good the idea is:

| | Limit |
|---|---|
| L1 | Hooks are ephemeral Node processes; `PreToolUse` runs on every tool call |
| L2 | DD requires one resident process per machine, shared by all projects; without it DD is inactive (never blocking) and says why |
| L3 | Three required dependencies (`@modelcontextprotocol/sdk`, `zod`, `@huggingface/transformers`) on Node ≥ 22; the model loads only in the resident, never on the hot path |
| L4 | The hook contract differs per harness; a veto is not portable |
| L5 | A hook failure must never block the host |
| L6 | Single-developer data volumes (90 days or 2000 telemetry rows) — no online learning |
| L7 | Local-first: git plus a derived SQLite index, nothing leaves the machine |

Do not propose PostgreSQL, Qdrant, an external vector store, an inference server, a hosted model,
federation, multi-tenancy or RBAC. Vectors live in the SQLite index. Documents describing those belonged to an earlier system and were removed.

## Where the truth is

- `docs/DD.md` — the behavioural contract DD guarantees today.
- `docs/architecture/plugin-constraints.md` — the boundary everything operates inside.
- `docs/architecture/invariants.md` — properties that must never break.
- `docs/memory/roadmap.md` — what comes next, and what was cut for being unreachable.
- `docs/specs/` — historical design records. Only `stability: implemented` describes current behaviour.
- **`src/` is authoritative over every document.** Where a document and the code disagree, the code is
  what DD does; fix the document.

## Non-negotiable properties

- Model output never mutates state. Promotion happens only through local human review.
- A reported success is telemetry. It never raises authority, confidence or promotion status.
- Evidence verification establishes integrity, never that a claim follows from it.
- Retrieval is project-scoped first, always. There is no global search and no cross-project fallback.
- Injected knowledge is advisory content, never a command, and never outranks the host or the user.

## Language

Everything in this repository is written in English: code, comments, documentation, plans, commit
messages, prompts and memories, whatever language the conversation uses. Spanish appears only as data
the code needs to understand Spanish input: correction patterns (`src/hooks/observe.js`), the concept
vocabulary (`src/engine/activation.js`), the language detector (`src/engine/language.js`) and test or
benchmark inputs that exercise them.

## Verification before claiming anything works

```bash
npm test          # full suite
npm run eval      # deterministic retrieval replay; CI gate is f1 >= 0.9 and exact >= 90%
npm run test:stress
```

The hot path is `PreToolUse`, once per tool call, with the cost dominated by Node start-up. Measure
ranking or gate changes there, not in a microbenchmark. Check changes to the hook contract against both
Claude Code and the `--codex` path in `src/hooks/run.js`.
