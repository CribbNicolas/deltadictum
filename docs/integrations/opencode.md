# OpenCode

**Status: adapter written and unit-tested against OpenCode's plugin API; not yet verified in a live
session.** Claude Code comes first; OpenCode follows Codex and Grok Build.

## Install

Add DD to the project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["deltadictum"]
}
```

OpenCode runs plugins in Bun, which has no `node:sqlite`, so the adapter imports nothing from DD: it runs
DD's hooks in Node, which must be 22.16 or later on the `PATH`.

## How DD reaches the agent on OpenCode

OpenCode has no hook that adds context before a tool runs, and text added to the system prompt changes it on
every delivery, which invalidates the prompt cache. DD therefore appends the memories that fire at a tool
call to that call's result, framed as advisory project knowledge, once per session. The system prompt is
left alone.

What OpenCode does not get: a memory arrives with the result of the call it applies to, not before it (a
read is unaffected; an edit learns of its trap one step late), and there is no Stop hook, so DD does not ask
the agent to save knowledge at the end of a turn and turn checks do not run. The agent can still save
knowledge when asked.
