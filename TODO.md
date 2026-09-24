# To do — DD (DeltaDictum)

Updated 2026-09-24. Only open items; each carries its references and needs no context from a past session.
Finished work is recorded in the commit history.

## 1. Publish 0.3.1 to npm — needs the owner, in a real terminal

`deltadictum@0.3.0` is on npm but broken in OpenCode (no `./server` export; the adapter imported
`node:sqlite`, which Bun lacks) and `scripts/check-codex.mjs` fails (no UI key; audited a project the
resident had not opened). Both fixed in `b9318aa` as 0.3.1, pushed. The npm account uses a security key:
`npm publish` must run in PowerShell or Windows Terminal, not through Claude Code's `!` (no TTY, so npm asks
for an OTP instead of opening the browser flow).

```powershell
cd C:\dev\supermem
npm publish        # open the printed link in Chrome, confirm with the security key
Remove-Item -Recurse -Force "$HOME\.cache\opencode\packages\deltadictum@latest"   # a copy patched during testing
```

Then confirm: `npm view deltadictum version` is 0.3.1; `npm install -g deltadictum`, `deltadictum install
--host codex --project <p>` and `node "$(npm root -g)/deltadictum/scripts/check-codex.mjs" --project <p>`
pass; OpenCode loads the plugin without error (`opencode serve --print-logs --log-level DEBUG`, then any
request with `?directory=<project>`; look for `service=plugin path=deltadictum`). Run these with
`DD_RESIDENT_REGISTRY` pointing at a temporary file, or they replace the machine's resident (item 5).

## 2. The agent never asks DD on its own in Claude Code (seen in the 2026-09-23/24 session)

In a long working session on this repository the model never called `orient`, `retrieve`, `propose` or
`feedback` until the user asked; it only received what hooks pushed (16 deliveries). Causes found:
- **On Claude Code, DD records no tool outcomes, so the Stop reminder only follows user corrections.**
  The Stop reminder does reach the model (it appeared after a detected user correction), but it fires
  only when the turn has recorded evidence, and this project's store holds 0 tool observations against 3
  user corrections, after a session full of passing and failing test runs. `observationFromTool`
  (`src/hooks/observe.js`) needs a numeric exit code or an `is_error` flag; Claude Code's Bash response
  carries neither on success, and a failed tool call probably fires `PostToolUseFailure`, which
  `hooks/hooks.json` does not register. Verify both shapes with a logging hook in a real session, then
  register the failure event and read Claude Code's success shape without guessing (L4).
- **Nothing tells the model to pull.** The SessionStart context names the `ui` tool only. The MCP server
  instructions ask for orient/retrieve/propose, but Claude Code defers MCP tools (names only, schema
  loaded by tool search), and hooks already push context, so pulling feels redundant. Consider one line
  in the SessionStart context: when to call `retrieve` and `propose`, and that the tools may need loading.
  Measure with the agent evaluation (item 10) before and after; the Stop prompt costs turns.
- **The dd skills are not loaded in this checkout.** The development setup (`.claude/settings.local.json`,
  root `.mcp.json`) registers hooks and MCP but not `skills/`; only a plugin install brings them.
- **A stale resident silences the rest of the session.** Editing `src/` makes the resident refuse hooks
  until the next session start; retrieval events dropped to 3 and 1 per hour during such stretches. Let the
  prompt hook (not pre-tool: L1) replace a stale resident, as session start does.
- **The session's MCP server keeps running the code it started with**: after the UI-key change its `status`
  still returned an address without the key (403). Reconnect with `/mcp` after changing `src/`.

## 3. Verify Grok Build live — blocked: Grok is not signed in

Run `grok login --device-code` (or set `XAI_API_KEY`), install the plugin
(`grok plugin marketplace add CribbNicolas/deltadictum`, `grok plugin install deltadictum@deltadictum --trust`),
then in another project: `grok -p "Report every 'DD -' line you received" --output-format json`.

Verified without a login (2026-09-23): marketplace install, MCP handshake through `grok mcp doctor`, and the
first-run package install (`docs/integrations/grok-build.md`). Still open: the hook payload and response
in a live session, and whether the background install and resident a hook starts survive Grok ending the
hook. Under `grok mcp doctor`, the install the MCP server started did not run. If `PreToolUse` fails:
remove `PreToolUse`, `UserPromptSubmit`, `PostToolUse` and `Stop` from `.grok-plugin/plugin.json`
and keep only `SessionStart`.

## 4. Verify OpenCode and Codex live — blocked: no working model credential

The Anthropic key has no credit, the OpenAI OAuth token fails to refresh (401), and MiniMax does not answer
even without DD. Refresh one (`opencode auth login`), then, with 0.3.1 published and `"plugin":
["deltadictum"]` in the project's `opencode.json`, run
`opencode run "Report every 'DD -' line in your system prompt" -m <provider/model>`. What to confirm: the
system prompt carries the advisory frame and DD's context (`docs/integrations/opencode.md`). Verified
without a model on 2026-09-24: OpenCode loads the plugin, and the adapter run under Bun injects the context.

For Codex: open a project installed with `deltadictum install --host codex`, trust the five hooks in
`/hooks`, and check that a session shows the audit UI address and that `dd` tools answer.

## 5. Two DD installs on one machine replace each other's resident

There is one resident per machine (L2), and a resident from another install is replaced at the next session
start (`src/resident.js`). A person with DD in both Claude Code and Grok Build, or a plugin plus a source
checkout, has each host's session start replace the other's resident and reload the model (seen
2026-09-23 while testing the Grok install). Decide whether a resident should serve any install of the same
version instead of only its own directory.

## 6. Verify a Claude Code session from the marketplace install

Marketplace install from GitHub and the MCP connection were verified in an isolated config dir
(2026-09-23). Not yet seen: a real session of the marketplace-installed plugin in another project, showing
the audit UI address at session start and, when the model is loading, "DD is active" on a later prompt.
`/plugin marketplace add CribbNicolas/deltadictum`, `/plugin install deltadictum@deltadictum`. This
changes the user's global Claude Code config; the source checkout's own hooks in
`.claude/settings.local.json` would then run alongside the plugin's in this repository.

## 7. Security hardening left open (from the 2026-09-24 review)

Fixed items are in `0fbfed4` and the README's "Security boundary". Still open, lower priority:
- The audit UI's CSP allows `'unsafe-inline'` scripts; moving the page script to a nonce or a file would
  make any future escaping mistake non-exploitable.
- `hasUnsafeMemoryContent` (`src/engine/v2/sanitizer.js`) is a phrase list; it stops obvious injection
  text only. Review remains the real control.
- The agent runs as the user and can write `.dd/` directly; documented as outside the boundary.

## 8. Test on a real Mac — blocked: no Mac available

Linux is verified (WSL Ubuntu, Node 22: full suite, stress, eval, semantic benchmark and the resident
process end to end through a symlink). macOS is covered in code only (`src/paths.js` folds case on darwin
and resolves symlinks such as `/tmp` → `/private/tmp`; `onnxruntime-node` ships darwin binaries). To run on
a Mac: `npm test`, `npm run bench:semantic` and a real session, ideally also on a case-sensitive APFS volume.

## 9. Archive memories that the code already states

Reviewed against "would an agent reading the code, tests and docs work this out on its own?". Archive in
the audit UI: `22291eb8`, `8724c2f2`, `bfacc975`, `b06e473d`, `292df784`, `9a955d61`, `c61d7902`,
`78f72b36`, `d0776c3c`. Keep `c2984ddd`: removing it made the auto-accept task cost $0.42 instead of $0.25
per run (plan, "Pruned store"). Update with what changed on 2026-09-22: `e57a21a9` (adoption now in
`adopt.js`), `e96a63b1` (`--test-force-exit` crashes the resident tests on Windows), `cf1ad3c5` (a stale
resident is now replaced at session start).

## 10. Measure the capture criterion (agent-level evaluation)

Capture memories under the new capture prompt during real work, then rerun
`node src/eval/agent/run.js --repeat=3` and compare with `output/eval/agent-results-full.json` (about $7 of
model usage per run). Three runs per cell leave a 2/18 difference within noise; five would settle the
pruning question.

## 11. Project-Patriark: semantic floor (optional)

After the translation the default floor reaches must recall 0.61 at precision 0.77 on Patriark's
benchmark. `semantic.floor: 0.025` in Patriark's `.dd/config.json` raised must recall further before the
translation, at the cost of one unrelated task no longer staying quiet. A choice for Patriark's owner.

## 12. Commit Patriark's translated memories

The 48 English memories and the archived Spanish originals are in `C:/dev/Project-Patriark/.dd/`,
uncommitted: that repository has no commits yet.
