# OpenCode installation

DD ships an OpenCode plugin adapter at `adapters/opencode/index.js`, published under the `deltadictum`
package's `exports` entry. OpenCode pulls plugins directly from npm — no installer script.

## Install

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["deltadictum"],
  "mcp": {
    "dd": {
      "type": "local",
      "command": ["npx", "-y", "deltadictum", "mcp"],
      "environment": { "DD_PROJECT_DIR": "<absolute-project-path>" },
      "enabled": true
    }
  }
}
```

(`adapters/opencode.json` in this repository is exactly this file, ready to copy.) Before publishing,
`"plugin"` also accepts a relative local path, e.g. `"./path/to/deltadictum/adapters/opencode/index.js"`
— OpenCode resolves it to a `file://` URL, useful for testing against a source checkout.

## What the adapter does, and what it doesn't

Confirmed against `@opencode-ai/plugin@1.18.31`'s published type definitions and a real installed
plugin's source (read 2026-09-19, not guessed): OpenCode's per-tool-call hooks (`tool.execute.before`/
`.after`) carry no field that can inject advisory text into the model's context, and the session
lifecycle hook (`event`) returns `void`. The only hook that accepts injectable text is
`experimental.chat.system.transform` (`output.system: string[]`), which fires once per chat turn, not
once per tool call — **there is no OpenCode hook shaped like Claude Code's `PreToolUse`.**

The adapter is scoped to what's real: it injects DD's session-start advisory pack once per session via
`experimental.chat.system.transform`. It does not do per-tool retrieval, and does not record tool
execution as telemetry — `tool.execute.after`'s output carries no structured exit/error signal, and
guessing at one risks misclassifying results rather than skipping them (the same policy
`src/hooks/observe.js` already applies to any host with an unconfirmed response shape).

## Verification scope

`opencode debug startup` was run against this checkout on 2026-09-19 (OpenCode 1.16.2, Windows) with the
plugin wired via a local `file://` path: completed clean, no import-time error. This confirms the
adapter's imports resolve and it doesn't crash at plugin-load time.

**Not verified:** that `experimental.chat.system.transform` actually fires and injects DD's context
during a real conversation turn — that needs a live model interaction with a configured provider, out of
scope for an automated check. Not verified either: the published-package install path end to end (`npm
publish` hasn't run — no npm auth in the environment that built this; package name `deltadictum` is
unscoped and was free on the registry as of 2026-09-19, re-check immediately before publishing).
