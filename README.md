# SuperMem

Behavioral memory plugin for Grok Build, Claude Code, Codex, and OpenCode.

It does not store chat history. It stores **what should change next time**, with a trigger, a behavior delta, and evidence. The goal is less context, lower cost, and faster work — by injecting only the memories that apply.

This repo ports the Orquesta `memory-api` V2–V6a **contracts** (admission, evidence, trigger retrieval, topic registry, contradiction/supersession). It does **not** port the Docker stack.

## Status

v1 engine, git+SQLite store, MCP tools, hooks, skills, and localhost audit UI are in this repo.

```bash
npm test    # 108 tests
npm start   # audit UI (from the target project cwd)
npm run mcp # MCP stdio server
```

## Principles

1. Save context (and therefore tokens).
2. Speed up development with precise, on-demand memory.
3. Humans can audit, edit, and delete memories.
4. Teams share via git (live server later, same schema).

## Layout

```
src/engine/     copied Orquesta v2–v6 pure modules
src/store/      git files + SQLite index (source of truth is the repo)
src/mcp/        MCP server
src/hooks/      SessionStart / prompt / observation / stop
src/ui/         localhost audit UI
plugin/         Grok / Claude Code plugin manifests
adapters/       Codex / OpenCode
docs/           memory contract copied from Orquesta
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

## Memory files (team share)

Admitted atoms live in the consuming project:

```
.supermem/atoms/<topic_key>.md
.supermem/registry/topics.json
.supermem/relations.json
```

Observations stay on the machine, not in git.

See `docs/SUPERMEM.md` for which Orquesta docs still apply.
