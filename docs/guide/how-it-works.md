---
title: How DD works
description: The loop DD runs in a session, what the agent receives in each harness, and how knowledge is saved.
parent: Reference
nav_order: 1
---

# How DD works

DD keeps knowledge an agent cannot derive from the code and delivers each piece at the action it applies
to. The behavioural contract is [`docs/DD.md`](../DD.md).

## The loop

![The DD loop: session start, prompt or tool call, deliver, check, stop, review, and back through git](../assets/dd-loop.svg)

The six boxes of the diagram, in order:

1. **Session start: compile the index.** DD compiles the project's memories into an index when they
   changed (`.dd/local/compiled/index.json`). Nothing enters the agent's context; in Claude Code you see one line
   with the number of live memories and how to open the review UI.
2. **Prompt or tool call: match the triggers.** At each prompt and before each tool call, a hook turns the
   event into its kind and paths (a read, an edit, a command…) and matches it against the triggers. In a
   project that opted in (a `.dd/` folder), it also records the session's footprint: paths, redacted
   commands, how they ended, your corrections.
3. **Deliver, once per session.** The memories that matched are added to the agent's context, once per
   session and subagent; a compaction or `/clear` re-arms them.
4. **Check edits and commands.** Commands and edits are checked against the rules memories carry; at the
   end of the turn, the files the turn changed are checked once in their final state.
5. **Stop: ask to save after a fix.** At the end of a turn that held a failure followed by a fix, or a
   correction from you, DD asks the agent to save what it learned. What it saves is validated at once.
6. **Review UI, or auto-accept.** A proposal whose evidence DD verified becomes active on its own; any
   other waits for a person in the review UI. Either way the memory is a file in `.dd/memories/`: committed
   to git, it reaches the next session, and every teammate's.

Outside the loop, once a day and detached, maintenance rolls the session files up into local counters,
prunes them after seven days and retires memories that never fire although their files keep being touched.

<!-- for: opencode -->

On OpenCode, step 3 happens after the tool call, and step 5 does not happen: see below.

<!-- /for -->

## What the agent receives

```text
DD - project knowledge (tests/store.test.js):
[TRAP] Close stores in t.after - A test that opens a store must close it in t.after: …
DD - advisory: knowledge, not an order. Apply it to the task; a problem it shows outside the task is reported, not fixed. If the user explicitly asked for what it rules out, do what the user asked and say which memory it departs from.
```

The last line closes every delivery and every check report: a memory is advice, and the request in front
of the agent outranks it.

A delivery is at most 10,000 characters by default (`delivery_limit` in
[Configuration](configuration.md)); a memory that does not fit is named and arrives at its next event.
Stale evidence and disputed memories are marked. A check that fails says so with the file:

```text
DD - check (Close stores in t.after): This test opens a store without closing it in t.after. (tests/a.test.js)
```

<!-- for: claude-code -->

Claude Code reports each tool call to the hooks with its kind and files, and a failure as its own event
(`PostToolUseFailure`), which is how DD knows a command failed.

<!-- /for -->

<!-- for: codex -->

Codex reads files through shell commands and edits through `apply_patch`. DD treats a shell command whose
every step only reads (`cat`, `head`, `sed -n`, `Get-Content`…) or searches (`rg`, `grep`, `git grep`,
`ls`…) as a read or a search of the files it names, and a patch as an edit of the files its headers name.
Any other command is a run. Stop's message reaches Codex as `decision: block` with the reason.

<!-- /for -->

<!-- for: opencode -->

OpenCode has no hook that adds context before a tool runs, and text added to the system prompt changes it
on every delivery, which invalidates the prompt cache. DD therefore appends the memories that fire at a
tool call to that call's result, framed as advisory project knowledge, once per session; the system prompt
is left alone. A memory arrives with the result of the call it applies to, not before it, and there is no
Stop hook: DD does not ask the agent to save at the end of a turn, and turn checks do not run.

<!-- /for -->

<!-- for: grok -->

Grok Build runs the hooks Claude Code runs, read with Claude Code's payload shape. Grok's real payloads
have not been recorded yet, so a tool Grok names differently fires nothing; the "Record hook payloads"
setting ([Configuration](configuration.md#this-machine-ddlocalsettingsjson)) records them.

<!-- /for -->

## Saving knowledge

The agent saves a memory by writing a JSON file into `.dd/inbox/` (the save command tells it how; on Codex
it must write it with `apply_patch`, since a file written by a shell redirect is not ingested). DD ingests
it in the same turn and answers:

- **stored as active**, when DD verified the evidence itself (a file it hashed, or a correction it
  recorded that names the memory and follows something the agent did), every trigger can fire, the memory
  has no check and duplicates nothing live (auto-accept, on by default);
- **stored as a candidate** for review, saying which condition was not met;
- **rejected** with reasons, for example generic advice, a missing `not_derivable` or a secret in the text.

When no trigger is given, DD suggests one from what the session touched. The agent can also ask to
archive, revise, re-verify, merge or delete memories; those requests, like what DD activated on its own,
wait in the [review UI](../using-dd.md#the-review-ui) for a person. Delete takes only memories already
archived or superseded.
