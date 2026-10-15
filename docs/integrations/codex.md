# Codex

**Status: adapter written and unit-tested against Codex payloads recorded in 2026-09 (codex-cli 0.154); not
yet verified in a live session.** Claude Code comes first; Codex is verified next.

## Install

Codex has no plugin marketplace, so DD writes the project's Codex configuration. Install DD globally first,
so the configuration points at a directory that stays (an `npx` cache can be cleared):

```bash
npm install -g deltadictum
deltadictum install --host codex --project "<absolute-project-path>" --dry-run   # what it would write
deltadictum install --host codex --project "<absolute-project-path>"
```

It writes, keeping everything else in each file:

- `.codex/hooks.json`: DD's hooks (session start, prompt, every tool call before and after, proposals made
  through `apply_patch`, and Stop), each running `hooks/run.cjs <command> --codex`;
- `.codex/config.toml`: a managed block saying DD runs no MCP server;
- `AGENTS.md`: a short managed block telling the agent what DD's deliveries are and how to save knowledge;
- `.agents/skills/dd-save`, `dd-recall`, `dd-review`: the commands, as Codex skills.

Then open the project in Codex, trust it, and trust DD's hooks in `/hooks`: Codex ignores a project's
`.codex/` configuration until both are trusted. After `npm update -g deltadictum`, run the install command
again; it refreshes DD's own handlers and keeps yours.

## How DD reads Codex

Codex reads files through shell commands and edits through `apply_patch`. DD treats a shell command whose
every step only reads (`cat`, `head`, `sed -n`, `Get-Content`…) or searches (`rg`, `grep`, `git grep`, `ls`…)
as a read or a search of the files it names, and a patch as an edit of the files its headers name. Any other
command is a run. Stop's message reaches Codex as `decision: block` with the reason.

Proposals must be written with `apply_patch` into `.dd/inbox/`; a file written by a shell redirect is not
ingested.
