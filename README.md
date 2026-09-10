# SuperMem

Behavioral memory plugin for Grok Build, Claude Code, Codex, and OpenCode.

It does not store chat history. It stores **what should change next time**, with a trigger, a behavior delta, and evidence. The goal is less context, lower cost, and faster work — by injecting only the memories that apply.

This repo ports the Orquesta `memory-api` V2–V6a **contracts** (admission, evidence, trigger retrieval, topic registry, contradiction/supersession). It does **not** port the Docker stack.

## Status

v1: git+SQLite store, compact FTS retrieve (max 8 hits, VPT 0.02), data-only deterioration health, MCP tools, hooks, skills, localhost audit UI.

```bash
npm test              # unit gate
npm run test:stress   # 2k-atom retrieve + health scale
npm run test:all      # both
npm start             # audit UI (from the target project cwd)
npm run mcp           # MCP stdio server
node src/cli.js health
```

Retrieve is O(hits). Opening the store hashes git atoms/registry/relations and skips SQLite rebuild when the fingerprint matches.

## Principles

1. Save context (and therefore tokens).
2. Speed up development with precise, on-demand memory.
3. Humans can audit, edit, and delete memories.
4. Teams share via git (live server later, same schema).

## Layout

```
src/engine/     V2–V6 admission/retrieve plus health/
src/store/      git files + SQLite index (source of truth is the repo)
src/mcp/        MCP server (compact JSON tool results)
src/hooks/      SessionStart / prompt retrieve / observation / Stop capture
src/ui/         localhost audit UI
plugin/         Grok / Claude Code plugin manifests
adapters/       Codex / OpenCode
docs/           memory contract, specs, test catalog
```

## Install

Requires Node 22+. From this checkout:

**Grok Build**

```bash
grok plugin marketplace add C:\dev\supermem
grok plugin install supermem --trust
```

Or point `[plugins].paths` at this repo. The plugin root is the repository (skills, hooks, `.mcp.json`, `plugin.json`).

**Claude Code**

```bash
claude plugin install C:\dev\supermem
```

**Codex / OpenCode**

Copy `adapters/AGENTS.md` into the target repo and register the MCP server from `adapters/opencode.json` (cwd = this checkout, run the agent in the project being developed).

**Audit UI**

```bash
cd <your-project>
node C:\dev\supermem\src\cli.js
```

Admitted atoms are written to `<your-project>/.supermem/atoms/` so they show up in `git diff`.

## How retrieve and capture work

- **Retrieve:** call `supermem_retrieve` with the coming action. Hits are compact (`content` only). On Grok, SessionStart stdout and UserPromptSubmit `additionalContext` are discarded — injection is a `PreToolUse` hook plus the model calling `supermem_retrieve`.
- **Health:** `supermem_health` / `node src/cli.js health` scores live-set deterioration from SQLite. No LLM, no git writes.
- **Capture:** on Stop, the host is asked to `supermem_propose` **at most once** if there is a reusable lesson. Admission still decides write/observe/block. This is not a session dump.

## Memory files (team share)

Admitted atoms live in the consuming project:

```
.supermem/atoms/<topic_key>.json
.supermem/registry/topics.json
.supermem/relations.json
```

Observations and SQLite stay on the machine, not in git.

## Docs

| Doc | What |
|---|---|
| `docs/SUPERMEM.md` | What binds vs what does not |
| `docs/specs/2026-09-09-retrieval-hot-path-and-scale.md` | Compact retrieve + FTS |
| `docs/specs/2026-09-10-memory-deterioration-detection.md` | Health definition |
| `docs/specs/2026-09-10-memory-quality-and-performance-tests.md` | Test catalog |
