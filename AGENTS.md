# Working on DeltaDictum

See [CLAUDE.md](CLAUDE.md). It applies to every agent working in this repository, not only to Claude Code.

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.** Before proposing any architecture, read the limits in CLAUDE.md: no database engine, no external vector store, no inference server, no hosted model, no federation, no resident process. Hooks are ephemeral processes and `PreToolUse` runs on every tool call; memories fire by rule matching over a compiled index, not by similarity search.

Everything in this repository is written in English, whatever language the conversation uses (see the Language section of CLAUDE.md).
