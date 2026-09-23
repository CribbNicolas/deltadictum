# To do — DD (DeltaDictum)

Updated 2026-09-23 (before merging feat/semantic-retrieval). Each item carries its references and needs no context from a past session.

## 1. ~~Decide the auto_accept policy~~ — decided 2026-09-22

Default `auto_accept: { enabled: true, confidence_threshold: 0.765 }` in `src/store/paths.js`
(filesystem × model_initiated): a model proposal with verified file evidence is auto-accepted. The user's
explicit decision.

## 2. Publish to npm

There is no `npm login` on this machine. The unscoped name `deltadictum` was free on the registry
(checked 2026-09-19). Until it is published, the OpenCode install (`"plugin": ["deltadictum"]`) does not
work. Deferred until DD is ready to publish.

```bash
npm login
cd C:/dev/supermem
npm publish --dry-run   # review what would be uploaded
npm publish
```

## 3. Verify Grok Build live

`grok plugin validate .` passed (valid schema, hooks and MCP servers detected). That does not confirm the
real `PreToolUse` contract (payload and response) works in a live session. Open a project with the plugin
installed and check whether `PreToolUse` errors.

If it fails: remove `PreToolUse`, `UserPromptSubmit`, `PostToolUse` and `Stop` from
`.grok-plugin/plugin.json` and keep only `SessionStart` (the fallback documented in
`docs/integrations/grok-build.md`).

## 4. Verify OpenCode live

`opencode debug startup` ran clean (the adapter imports without error). That does not confirm that
`experimental.chat.system.transform` injects DD context in the middle of a real conversation. Technical
detail in `docs/integrations/opencode.md`.

## 5. Test a real install from another project (Claude Code, Grok Build)

- **Claude Code**: `/plugin marketplace add <your-org>/deltadictum` → `/plugin install deltadictum@deltadictum`
- **Grok Build**: the equivalent with `grok plugin marketplace` / `grok plugin install`

Codex is tested end to end (package built with `npm pack`, installed in another project, installer run,
`check-codex.mjs` confirmed a real connection). The other two are not.

## 6. ~~Gaps 6 and 7~~ — closed 2026-09-22

See `docs/memory/roadmap.md`: `src/store/adopt.js` (gap 6) and `src/hooks/build.js` (gap 7).

## 7. ~~README section "Resident process"~~ — written 2026-09-22

The SessionStart notice points to it when retrieval is lexical.

## 8. Semantic retrieval and agent-level evaluation

See `docs/plans/2026-09-22-semantic-retrieval-plan.md`, sections "Phase 6" and "Still open".

## 9. Test on a real Mac — blocked: no Mac available (2026-09-22)

Kept here until one is available.

Linux is verified (WSL Ubuntu, Node 22: full suite, stress, eval, semantic benchmark and the resident
process end to end through a symlink). macOS was not run: it is covered in code (`src/paths.js` folds case on
darwin and resolves symlinks such as `/tmp` → `/private/tmp`) and `onnxruntime-node` ships darwin
binaries. Still to run on a Mac: `npm test`, `npm run bench:semantic` and a real session, ideally also on a
case-sensitive APFS volume.

## 10. Stale memories — replacements proposed 2026-09-22

`ui/server-routes-need-restart/shared-process-with-mcp` (8b7195a9) says killing the UI kills the MCP
tools; since 2026-09-22 the UI is the resident process (`src/resident.js`). Replacement candidate
`ca2e2d89`. Also pending: `297bd600` (replaces `compact-fts`), `ad3fdaa9` (path comparisons),
`6abc175a` (scripted edits, without the project-wide scope). Review them in the audit UI.

## 11. Archive memories that the code already states (review 2026-09-23)

Reviewed against "would an agent reading the code, tests and docs work this out on its own?". Archive in
the audit UI: `22291eb8`, `8724c2f2`, `bfacc975`, `b06e473d`, `292df784`, `9a955d61`, `c61d7902`,
`78f72b36`, `d0776c3c`. Keep `c2984ddd`: pruning it with the others made the auto-accept task cost $0.42
instead of $0.25 per run (plan, "Pruned store"); it is not a duplicate of `d3d5bf57`. Update with what changed on 2026-09-22: `e57a21a9` (adoption now in
`adopt.js`), `e96a63b1` (`--test-force-exit` crashes the resident tests on Windows), `cf1ad3c5` (a stale
resident is now replaced at session start).

## 12. Translate Project-Patriark's memories to English

All 48 predate the English-only rule; new proposals in another language are refused. The measured gain
from translating alone was small (semantic must recall 0.49 to 0.54 on the missed memories), so rewrite
them as full English sentences of behaviour, and review them in Patriark's audit UI.

## 13. Agent-level evaluation: harness and follow-up

- Rephrase the `error-code-hint` task: one agent read "Reject memory proposals whose trigger..." as a rule
  for itself and implemented nothing. Phrase every task as a change to the code.
- Tasks that run the full suite outlive the agent's 300 s foreground wait (`retrieve-title`): point the
  prompt at the relevant test file, or allow a longer command timeout.
- Measure the capture criterion (TODO #11 context): capture memories under the new prompt during real work,
  then rerun `node src/eval/agent/run.js --repeat=3` and compare with `output/eval/agent-results-full.json`.
- Three runs per cell leave a 2/18 difference within noise; five would settle the pruning question.

## 14. Project-Patriark: semantic floor

Its memories are terse; `semantic.floor: 0.025` in Patriark's `.dd/config.json` raised must recall from
0.46 to 0.68 at precision 0.70, with one of three unrelated tasks no longer quiet (plan, "Project-wide
scopes and per-project calibration"). A choice for Patriark's owner; after #12 the default may suffice.

## 15. ~~Check the package before publishing~~ — checked 2026-09-23

`npm pack --dry-run`: 135 files, 274 KB. `@huggingface/transformers` is declared optional and not bundled,
`skills/` is included, `.dd/` is not. `files` now ships only the docs users read (DD.md, architecture, integrations,
evaluation, memory, decisions), not the historical plans and specs.
