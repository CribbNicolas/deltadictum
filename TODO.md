# To do — DD (DeltaDictum)

Updated 2026-09-23. Only open items; each carries its references and needs no context from a past session.
Finished work is recorded in the commit history.

## 1. Publish to npm

There is no `npm login` on this machine. The unscoped name `deltadictum` was free on the registry
(checked 2026-09-19). Until it is published, the OpenCode install (`"plugin": ["deltadictum"]`) does not
work. Deferred until DD is ready to publish; the package contents were checked on 2026-09-23
(`npm pack --dry-run`).

```bash
npm login
cd C:/dev/supermem
npm publish --dry-run   # review what would be uploaded
npm publish
```

## 2. Verify Grok Build live — blocked: Grok is not signed in

Run `grok login --device-code` (or set `XAI_API_KEY`), install the plugin
(`grok plugin marketplace add CribbNicolas/deltadictum`, `grok plugin install deltadictum@deltadictum --trust`),
then in another project: `grok -p "Report every 'DD -' line you received" --output-format json`.

Verified without a login (2026-09-23): marketplace install, MCP handshake through `grok mcp doctor`, and the
first-run package install (`docs/integrations/grok-build.md`). Still open: the hook payload and response
in a live session, and whether the background install and resident a hook starts survive Grok ending the
hook. Under `grok mcp doctor`, the install the MCP server started did not run. If `PreToolUse` fails:
remove `PreToolUse`, `UserPromptSubmit`, `PostToolUse` and `Stop` from `.grok-plugin/plugin.json`
and keep only `SessionStart`.

## 3. Verify OpenCode live — blocked: no working model credential

The Anthropic key has no credit, the OpenAI OAuth token fails to refresh (401), and MiniMax does not answer
even without DD. Refresh one (`opencode auth login`), then run
`opencode run "Report every 'DD -' line in your system prompt" -m <provider/model>` in a project whose
`opencode.json` loads the adapter (`"plugin": ["file:///<dd>/adapters/opencode/index.js"]`, no npm publish
needed) and the MCP server by absolute path. What to confirm: that
`experimental.chat.system.transform` injects DD context in a real conversation
(`docs/integrations/opencode.md`).

## 4. Two DD installs on one machine replace each other's resident

There is one resident per machine (L2), and a resident from another install is replaced at the next session
start (`src/resident.js`). A person with DD in both Claude Code and Grok Build, or a plugin plus a source
checkout, has each host's session start replace the other's resident and reload the model (seen
2026-09-23 while testing the Grok install). Decide whether a resident should serve any install of the same
version instead of only its own directory.

## 5. Test on a real Mac — blocked: no Mac available

Linux is verified (WSL Ubuntu, Node 22: full suite, stress, eval, semantic benchmark and the resident
process end to end through a symlink). macOS is covered in code only (`src/paths.js` folds case on darwin
and resolves symlinks such as `/tmp` → `/private/tmp`; `onnxruntime-node` ships darwin binaries). To run on
a Mac: `npm test`, `npm run bench:semantic` and a real session, ideally also on a case-sensitive APFS volume.

## 6. Archive memories that the code already states

Reviewed against "would an agent reading the code, tests and docs work this out on its own?". Archive in
the audit UI: `22291eb8`, `8724c2f2`, `bfacc975`, `b06e473d`, `292df784`, `9a955d61`, `c61d7902`,
`78f72b36`, `d0776c3c`. Keep `c2984ddd`: removing it made the auto-accept task cost $0.42 instead of $0.25
per run (plan, "Pruned store"). Update with what changed on 2026-09-22: `e57a21a9` (adoption now in
`adopt.js`), `e96a63b1` (`--test-force-exit` crashes the resident tests on Windows), `cf1ad3c5` (a stale
resident is now replaced at session start).

## 7. Measure the capture criterion (agent-level evaluation)

Capture memories under the new capture prompt during real work, then rerun
`node src/eval/agent/run.js --repeat=3` and compare with `output/eval/agent-results-full.json` (about $7 of
model usage per run). Three runs per cell leave a 2/18 difference within noise; five would settle the
pruning question.

## 8. Project-Patriark: semantic floor (optional)

After the translation the default floor reaches must recall 0.61 at precision 0.77 on Patriark's
benchmark. `semantic.floor: 0.025` in Patriark's `.dd/config.json` raised must recall further before the
translation, at the cost of one unrelated task no longer staying quiet. A choice for Patriark's owner.

## 9. Commit Patriark's translated memories

The 48 English memories and the archived Spanish originals are in `C:/dev/Project-Patriark/.dd/`,
uncommitted: that repository has no commits yet.
