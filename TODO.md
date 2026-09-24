# To do — DD (DeltaDictum)

Updated 2026-09-24. Only open items; each carries its references and needs no context from a past session.
Finished work is recorded in the commit history. Everything left needs something outside this repository:
a login, a model credential, a separate Claude Code install, or a Mac.

## 1. Verify Grok Build live — blocked: Grok is not signed in

Run `grok login --device-code` (or set `XAI_API_KEY`), install the plugin
(`grok plugin marketplace add CribbNicolas/deltadictum`, `grok plugin install deltadictum@deltadictum --trust`),
then in another project: `grok -p "Report every 'DD -' line you received" --output-format json`.

Verified without a login (2026-09-23): marketplace install, MCP handshake through `grok mcp doctor`, and the
first-run package install (`docs/integrations/grok-build.md`). Still open: the hook payload and response
in a live session, and whether the background install and resident a hook starts survive Grok ending the
hook. Under `grok mcp doctor`, the install the MCP server started did not run. If `PreToolUse` fails:
remove `PreToolUse`, `UserPromptSubmit`, `PostToolUse` and `Stop` from `.grok-plugin/plugin.json`
and keep only `SessionStart`. Also record Grok's `PostToolUse` payload for a passing and a failing command:
`observationFromTool` (`src/hooks/observe.js`) reads outcomes without an exit code only on Claude Code, so
if Grok matches Claude Code's shape it needs the same treatment and a `PostToolUseFailure` registration.

## 2. Verify OpenCode and Codex live — blocked: no working model credential

The Anthropic key has no credit, the OpenAI OAuth token fails to refresh (401), and MiniMax does not answer
even without DD. Refresh one (`opencode auth login`), then, with 0.3.1 on npm and `"plugin":
["deltadictum"]` in the project's `opencode.json`, run
`opencode run "Report every 'DD -' line in your system prompt" -m <provider/model>`. What to confirm: the
system prompt carries the advisory frame and DD's context (`docs/integrations/opencode.md`). Verified
without a model on 2026-09-24: OpenCode loads the plugin, and the adapter run under Bun injects the context.

For Codex: open a project installed with `deltadictum install --host codex`, trust the five hooks in
`/hooks`, and check that a session shows the audit UI address and that `dd` tools answer.

Run install checks with `DD_RESIDENT_REGISTRY` pointing at a temporary file, or they replace the machine's
resident when their version differs.

## 3. Verify a Claude Code session from the marketplace install

Marketplace install from GitHub and the MCP connection were verified in an isolated config dir
(2026-09-23). Not yet seen: a real session of the marketplace-installed plugin in another project, showing
the audit UI address at session start and, when the model is loading, "DD is active" on a later prompt.
`/plugin marketplace add CribbNicolas/deltadictum`, `/plugin install dd@deltadictum`. This
changes the user's global Claude Code config. Also confirm there what 2026-09-24 changed: a failing Bash
call records a `tool_failure` observation (`PostToolUseFailure`), a passing test run a `validation`, and
the session start carries the line telling the model when to call `retrieve` and `propose`.

## 4. Test on a real Mac — blocked: no Mac available

Linux is verified (WSL Ubuntu, Node 22: full suite, stress, eval, semantic benchmark and the resident
process end to end through a symlink). macOS is covered in code only (`src/paths.js` folds case on darwin
and resolves symlinks such as `/tmp` → `/private/tmp`; `onnxruntime-node` ships darwin binaries). To run on
a Mac: `npm test`, `npm run bench:semantic` and a real session, ideally also on a case-sensitive APFS volume.
