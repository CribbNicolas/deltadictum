# Grok Build installation

DD ships as a native Grok Build plugin via `.grok-plugin/plugin.json` and `.grok-plugin/marketplace.json`
at the repository root, mirroring the Claude Code marketplace layout (`${GROK_PLUGIN_ROOT}` in place of
`${CLAUDE_PLUGIN_ROOT}`). This repository is also usable as a project-level Grok config directly —
`.grok/hooks/dd.json` and `.grok/rules/dd.md` already register DD's hooks and instructions for anyone
working inside this checkout, independent of the plugin/marketplace path.

## Install

From another project, add this repository as a marketplace source and install the plugin (see Grok
Build's own `/plugins` extensions modal or `grok plugin marketplace` subcommand for the exact add
command — not yet exercised end-to-end from a second project by this repository's own tooling).

```bash
grok plugin validate .   # from this checkout, before publishing anywhere
```

## Verification scope

`grok plugin validate .` was run directly against this checkout on 2026-09-19 (Grok Build 1.0.25,
Windows): **valid**, reporting 1 skill dir, hooks, and MCP servers as discovered components. It also
confirmed `grok inspect` already picks up `.grok/rules/dd.md` as a project instruction and the project's
`hooks/hooks.json` / `.grok/hooks/dd.json` hooks as active, unrelated to the plugin/marketplace path.

**Not verified:** the actual runtime shape of Grok Build's `PreToolUse`-equivalent hook payload and
response. `grok plugin validate .` checks manifest schema only, not a live tool call. `.grok-plugin/
plugin.json`'s hooks reuse the same `hooks/run.cjs` commands already exercised by the project-level
`.grok/hooks/dd.json`, on the assumption (stated in Grok Build's own docs and marketing) that its hook
contract is drop-in compatible with Claude Code's. If a live session shows the `PreToolUse` hook
rejected or mishandled, remove it from `.grok-plugin/plugin.json`, keeping `SessionStart` only.

Also unverified: installing this repository as a marketplace source from a *different* project (the
`grok plugin marketplace add` / `grok plugin install` round trip). `grok inspect` in this checkout
reports `Marketplaces (0)` — expected, since a marketplace.json sitting in a repo doesn't self-register;
a user must add it explicitly, same as Claude Code's `/plugin marketplace add`.
