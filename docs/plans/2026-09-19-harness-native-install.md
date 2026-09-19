---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-19
depends_on:
  - architecture/plugin-constraints.md
  - integrations/codex.md
do_not_co_load_with: []
---

# Native install per harness — Claude Code, Grok Build, OpenCode, Codex

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence for this plan |
|---|---|---|
| L1 | Hooks are ephemeral; `PreToolUse` runs on every tool call | Not relevant — install-time only |
| L2 | No guaranteed persistent process | Not relevant — install-time only |
| L3 | Two dependencies, Node ≥ 22 | The published npm package must not gain a dependency beyond `@modelcontextprotocol/sdk` and `zod` |
| L4 | The hook contract differs per harness | **Central to this plan.** Each harness glue layer translates to/from that harness's own hook shape; `src/hooks/*.js` stays harness-agnostic |
| L5 | A hook failure must never block the host | An install script must be safe to re-run and must never leave a harness config half-written (see per-op preflight pattern already in `scripts/install-codex.mjs`) |
| L6 | Single-developer volumes | Not relevant — install-time only |
| L7 | Local-first | Marketplace/npm sources fetch code, not data; no project knowledge leaves the machine through the install path itself |

## Invariants this plan must not break

None of `INV-01` through `INV-06` in [`architecture/invariants.md`](../architecture/invariants.md) govern
install/distribution — they govern the store and retrieval. This plan touches none of that surface. The
one property worth stating explicitly because it's new: **`src/` is never harness-specific.** Every file
this plan adds either configures a harness to call into existing `src/` entry points, or is a thin
translation shim (same pattern as the existing `--codex` branch in `src/hooks/run.js`) that converts one
harness's hook payload shape into the shape `src/hooks/*.js` already expects, and converts the response
back. No harness-specific logic is duplicated into `src/`.

## Start here: confirm the ground before writing code

This plan was written against the repository at a point in time and against each harness's public docs
as fetched 2026-09-19. Re-check before implementing:

```bash
# Core/glue split still holds — no harness name should appear under src/hooks or src/mcp.
grep -rniE "claude.?code|codex|opencode|grok.?build" src/hooks src/mcp

# package-lock.json is still tracked (Claude Code marketplace installs depend on this for auto npm install).
git ls-files package-lock.json

# npm name is still free.
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/deltadictum   # expect 404

# Current state of the manifests this plan replaces/adds.
cat plugin.json plugin/plugin.json 2>&1
ls .claude-plugin .grok-plugin 2>&1   # expect: not found, both new
```

If any of these disagree with what's written below, stop and report the difference before proceeding.

## Decision: market for three, npx for one

Recorded as DD proposal `23b85e93-9a38-419d-bcd1-2a06699ee2ec` (pending review), reached after fetching
each harness's 2026 docs:

| Harness | Native pull mechanism | Needs from this plan |
|---|---|---|
| **Claude Code** | Git-hosted marketplace: `.claude-plugin/marketplace.json` + `.claude-plugin/plugin.json`. `/plugin marketplace add owner/repo` → `/plugin install <name>@<marketplace>`. | Move manifest into `.claude-plugin/`, add self-listing marketplace, switch hook commands to `${CLAUDE_PLUGIN_ROOT}`. **No npm publish.** |
| **Grok Build** | Same shape: `.grok-plugin/plugin.json` + `.grok-plugin/marketplace.json`, `${GROK_PLUGIN_ROOT}`, `[[marketplace.sources]]`. | New `.grok-plugin/` dir mirroring the Claude one. Hook payload shape needs verification against a real Grok Build plugin before wiring (docs didn't publish the schema — see Open items). **No npm publish.** |
| **OpenCode** | `plugin: ["pkg-name"]` in `opencode.json` pulls straight from npm; a plugin is a JS/TS module exporting `tool.execute.before`, `session.created`, `session.idle`, etc. | **Needs npm publish.** One thin adapter module translating those hook names to `src/hooks/pre-tool.js` / `session-start.js`, exported from `package.json`. |
| **Codex** | None. Plugins are OpenAI-curated only; project MCP/hooks are hand-written, no marketplace, no npm-pull. | The one harness needing a shipped installer. `scripts/install-codex.mjs` already implements this correctly per-project; generalize behind `npx deltadictum install --host codex`. |

Rejected alternative: a single uniform `dd install --host <any>` script for all four. Rejected because it
would duplicate a pull mechanism two harnesses (Claude Code, Grok Build) and one package manager
(OpenCode) already provide natively — more surface to maintain for no capability gained, and it hides
the fact that "installed" means something different per harness (a marketplace install self-updates on
`marketplace update`; a script-written config does not).

## Repo layout delta

```
.claude-plugin/
  plugin.json         # moved from root plugin.json, unchanged content
  marketplace.json     # new — self-listing, source: "./"
.grok-plugin/
  plugin.json          # new
  marketplace.json     # new — self-listing, source: "./"
adapters/opencode/
  index.js             # new — thin hook-shim, imports src/hooks/pre-tool.js, session-start.js
hooks/hooks.json        # command strings switch to ${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs
src/cli.js               # gains an "install" subcommand (--host codex today; shape leaves room for more)
scripts/install-codex.mjs  # logic moves under src/cli.js's install subcommand; script becomes a thin re-export or is removed once the subcommand ships
plugin/                  # retired — superseded by .claude-plugin/ + .grok-plugin/; plugin/hooks/hooks.json's ../../hooks/run.cjs indirection goes away with it
package.json              # add "exports" so adapters/opencode/index.js is importable as the package's default/named export; bump "files" to include .claude-plugin, .grok-plugin, adapters
```

`src/hooks/pre-tool.js`, `session-start.js`, `observe.js`, `capture.js`, `src/mcp/server.js` — unchanged
by this plan.

## Bundled fix: the Claude Code `decision` field

Found live in this session (see conversation, not yet filed as its own proposal): `src/hooks/run.js`'s
`ok()` only strips the legacy top-level `decision: 'allow'` field `if (codexHost)`. Claude Code's current
harness rejects any top-level `decision` on `PreToolUse` output (wants `hookSpecificOutput.permissionDecision`
or nothing). This fires on every non-`dd__` tool call today, fails open (L5 held), but is noise on every
install this plan produces. Fix belongs in this plan's implementation pass since it's the same file
(`src/hooks/run.js`) and the same "harness contract" surface as everything else here: strip `decision`
unconditionally in `ok()`, not just for `codexHost`.

## Open items to resolve during implementation

1. **Grok Build's actual `PreToolUse`-equivalent payload/response shape.** Docs list the hook discovery
   paths but not the JSON contract. Before wiring `.grok-plugin/`, find a real installed Grok Build
   plugin with a hook and read its handler, or open an issue/ask upstream. If the shape can't be
   confirmed, ship `.grok-plugin/` with `SessionStart`-equivalent only (advisory context, no per-tool
   hook) rather than guess at a contract and risk an L4 violation.
2. **npm publish name.** `deltadictum` unscoped is free on the registry as of 2026-09-19 (re-check before
   publishing — a last-resort recheck, since names can be taken between planning and publish). Decide
   scoped vs. unscoped before the first `npm publish` (hard to reverse — unpublish policy is restrictive).
3. **`package.json` `exports` field.** Needs a stable entry point for the OpenCode adapter distinct from
   the CLI `bin` entries.

## Done when

- `claude plugin validate .` passes against `.claude-plugin/`.
- A fresh Claude Code session in a *different* project, after `/plugin marketplace add` + `/plugin install`,
  shows the DD audit URL on `SessionStart` and answers `orient` — same bar as the manual verification
  already done in this project.
- `node scripts/check-codex.mjs --project <other-project>` passes after `npx deltadictum install --host codex
  --project <other-project>` run from outside this repo (e.g. from a tmp checkout via `npm pack`, not `npm link`).
- OpenCode and Grok Build verification steps get written into `docs/integrations/` once each is
  implemented, matching the existing `docs/integrations/codex.md` shape.
- `npm test` and `npm run eval` still pass — this plan should not touch retrieval/admission code at all,
  so a failure here means scope crept into `src/`.
