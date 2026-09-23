# Grok Build installation

DD ships as a native Grok Build plugin via `.grok-plugin/plugin.json` and `.grok-plugin/marketplace.json`
at the repository root, mirroring the Claude Code layout (`${GROK_PLUGIN_ROOT}` in place of
`${CLAUDE_PLUGIN_ROOT}`). This repository is also usable as a project-level Grok config directly —
`.grok/hooks/dd.json` and `.grok/rules/dd.md` already register DD's hooks and instructions for anyone
working inside this checkout, independent of the plugin/marketplace path.

## Install

```bash
grok plugin marketplace add CribbNicolas/deltadictum
grok plugin install deltadictum@deltadictum --trust
```

`grok plugin install CribbNicolas/deltadictum --trust` installs the same plugin without registering the
marketplace. `--trust` is required for hooks and MCP servers to load.

Grok copies the plugin's files but not its packages. The first session installs them into the plugin
directory in the background (`scripts/install-deps.mjs`, `npm ci --omit=dev --ignore-scripts`), says DD
is inactive meanwhile, and starts the resident when they are in place. The MCP server exits with the
same explanation on stderr until then; `/mcps` reconnects it. After `grok plugin update`, the new copy
installs its packages the same way.

## How the manifest is laid out, and why

Each of these was found by installing the plugin into an isolated Grok home (Grok Build 1.0.41, Windows,
2026-09-23) and checking it with `grok mcp doctor`:

- **MCP server: `"mcpServers": "./.grok-plugin/mcp.json"`**, a file whose path is anchored at
  `${GROK_PLUGIN_ROOT}`. Grok ignored an inline `mcpServers` object in `plugin.json` and fell back to the
  root `.mcp.json`, whose relative `mcp.js` resolves in the user's project. It does not expand
  `${VAR:-default}`. The root `.mcp.json` stays relative because it is this checkout's project config.
- **Marketplace source: `{ "source": "url", "url": ".../deltadictum.git" }`.** Grok refuses `"./"` as a
  plugin source ("marketplace path is empty"); a plugin at the repository root must be named by URL.
- **Packages:** Grok's own guide states plugins deliver files, not runtimes; the installed copy has no
  `node_modules` (see above).

## Verification scope

Verified 2026-09-23: marketplace add and install from GitHub; `grok mcp doctor` reporting the handshake
and all ten tools once the packages were installed; the first-run package install and resident start,
by running the plugin's `session-start` hook in a copy without `node_modules`.

**Not verified:** the hooks in a live Grok session (payload and response shape of its `PreToolUse`
equivalent), which needs `grok login`. `grok plugin validate .` checks the manifest schema only. If a live
session shows the `PreToolUse` hook rejected or mishandled, remove it from `.grok-plugin/plugin.json`,
keeping `SessionStart` only. Also unverified: whether a background process a hook starts survives when
Grok ends the hook; under `grok mcp doctor`, the install the MCP server started did not run.
