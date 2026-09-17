# Working on DeltaDictum

See [CLAUDE.md](CLAUDE.md). It applies to every agent working in this repository, not only to Claude Code.

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.** Before proposing any architecture, read [`docs/architecture/plugin-constraints.md`](docs/architecture/plugin-constraints.md): no embeddings, no database engine, no vector store, no inference server, no background workers, no federation. Hooks are ephemeral processes and `PreToolUse` runs on every tool call.
