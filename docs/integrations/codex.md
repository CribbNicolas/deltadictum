# Codex project installation

DD can run in a local Codex project using a stdio MCP server, project skills and Codex hooks. This development installation points to the source checkout; it does not register a global marketplace plugin.

## Install

From the DD checkout, with dependencies installed:

```powershell
node scripts/install-codex.mjs --project "C:/dev/Perfect Brew" --dry-run
node scripts/install-codex.mjs --project "C:/dev/Perfect Brew"
node scripts/check-codex.mjs --project "C:/dev/Perfect Brew"
```

The installer adds a marked DD block to project configuration and instructions, preserving unrelated content. It merges DD hooks with existing hooks and refuses to overwrite a different DD MCP server or customized skill. Running it again with unchanged sources has no effect.

Created or updated project files:

- `.codex/config.toml`: the absolute Node/server paths, project cwd and project-specific data directory.
- `.codex/hooks.json`: orientation, recall, selective observation and capture hooks.
- `.agents/skills/dd/SKILL.md`, `dd-save/SKILL.md`, `dd-audit/SKILL.md`: the three project skills.
- `AGENTS.md`: a short DD workflow section.
- `.dd/.gitignore`: exclusions for local cache and runtime capabilities.

Shared decisions live in `.dd/atoms`, `.dd/candidates` and `.dd/archive`. The local SQLite index and telemetry live in `.dd/local`, which is ignored. The setup contains absolute paths for this machine; rerun/review configuration when moving the source checkout. A standalone CLI process must use the same `DD_DATA=<project>/.dd/local` value to share telemetry with the installed MCP server.

## Activate in Codex

Open the target project in Codex and start a new conversation. Codex loads project MCP configuration only for trusted projects; see [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

Review the five DD hooks in `/hooks`. Codex requires trust for each new or changed hook definition. The installer leaves that trust decision to the user and does not change sandbox or approval settings. See [official hook trust behavior](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks).

Until hooks are trusted, the MCP tools and project skills remain usable in a trusted project. In the CLI, `/mcp` lists active servers. If tools have not appeared in the app, restart the MCP connection and start a new conversation.

Suggested first prompt:

> Usa DD para orientarte en este proyecto. Revisa README.md y los documentos de arquitectura pertinentes. Propón las decisiones reutilizables que encuentres con evidencia y condiciones de validez. Déjalas pendientes de revisión y dame el enlace de auditoría.

Open the URL returned by `dd.ui` to review evidence and approve useful proposals. An empty installation has no approved project decisions; orientation can still derive a small map from repository sources.

## Codex-specific behavior

- Hooks use absolute executable/script paths and a Windows command override, so spaces in project names are supported.
- `apply_patch` file headers become structured applicability paths.
- The session hook supplies the session ID used for delivery deduplication. Compaction/clear resets deliveries so relevant knowledge can be injected again.
- A Codex Stop continuation is requested only after a recorded validation/failure, at most once per turn. A new user prompt rearms the reminder; previously offered evidence alone does not trigger it again. The `stop_hook_active` guard prevents loops. Agent-driven proposals remain available without a count limit per call or session.
- Host observations require a structured exit/error signal. Unknown response formats are skipped rather than interpreted as verified execution results. No transcript is read.
- No PermissionRequest hook is installed, and DD does not grant command approvals.

## Verification scope

`check-codex.mjs` launches the actual server over stdio in the target project, enumerates tools, calls status and orientation, and verifies the audit HTTP endpoint. It makes no model calls and closes the diagnostic server afterward; Codex owns the process it starts later.

Tests cover the installer, paths with spaces, preservation of existing settings, Codex hook output, capture-loop protection and recall after compaction. Hook trust and actual model use are verified in the new Codex conversation.

### Local installation verified on 2026-09-10

Target: `C:/dev/Perfect Brew`; source: `C:/dev/supermem`; Codex CLI 0.153.4; Node 24.13.0.

The actual Codex app-server configuration API, using the user's profile, reports DD enabled from the project layer. Skills discovery reports all three DD skills enabled. Hooks discovery reports all five project hooks without warnings/errors, with trust still pending user review. The direct stdio check reports all ten MCP tools and a working audit endpoint. Orientation identifies Perfect Brew, `project.godot` and README source context. No model was invoked and no project decisions were seeded.

An isolated sandbox profile can report different project trust than the user's desktop profile. Verify the effective configuration under the same user/host that will run Codex; do not change project trust merely to make a sandbox diagnostic pass.
