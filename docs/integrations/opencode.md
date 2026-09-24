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
`experimental.chat.system.transform`, framed as advisory data that never overrides the user or the host,
since it lands in the system prompt. It does not do per-tool retrieval, and does not record tool
execution as telemetry — `tool.execute.after`'s output carries no structured exit/error signal, and
guessing at one risks misclassifying results rather than skipping them (the same policy
`src/hooks/observe.js` already applies to any host with an unconfirmed response shape).

OpenCode runs plugins in Bun, which has no `node:sqlite`, so the adapter imports none of DD: it runs the
SessionStart hook the other hosts run (`hooks/run.cjs`) in Node and injects its context. That hook reaches
the machine's resident, or starts one, waits briefly for it, and says whether DD is active. Node 22 or
later must be on `PATH`; without it nothing is injected and OpenCode is unaffected. OpenCode loads the
package's `./server` export and calls every export of that module as a plugin, so the module exports
only the plugin function.

## Verification scope

Verified 2026-09-24 with the published package and OpenCode 1.16.2 (Windows): OpenCode installs
`deltadictum` from npm with its dependencies and loads the plugin without error (`opencode serve`
with `--print-logs`, then a request for the project), and the adapter run under Bun injects the framed
session context and the audit UI address in about 1.3 s.

The 2026-09-19 check (`opencode debug startup` completing) proved less than it seemed: the package then
had no `./server` export, so OpenCode never loaded the adapter, which would also have failed in Bun on
`node:sqlite`.

**Not verified:** a real conversation turn, which needs a working model credential (`TODO.md`).
