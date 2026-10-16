---
title: Memories
description: "The DeltaDictum memory format: one JSON file per memory in .dd/memories/, with its triggers, checks and evidence."
parent: Reference
nav_order: 2
---

# Memories

A memory is one JSON file, `.dd/memories/<id>.json`, committed with the project. The authoritative
definition is `src/memory/schema.js`.

```json
{
  "schema_version": 8,
  "id": "6f1c…",
  "project_id": "my-app",
  "topic": "testing/store-handle",
  "kind": "trap",
  "status": "active",
  "title": "Close stores in t.after",
  "body": "A test that opens a store must close it in t.after: a failing assertion otherwise leaves the handle open and node --test never ends.",
  "not_derivable": "Only a hung CI run shows it; no test or comment says so.",
  "triggers": [{ "on": ["edit", "write"], "paths": ["tests/**/*.test.js"], "symbols": ["createStore"] }],
  "evidence": [{ "type": "file", "path": "tests/store.test.js", "sha256": "…", "summary": "The test that hung" }],
  "origin": "model_initiated",
  "replaces": null,
  "revisit_when": [],
  "review": { "migrated": false, "issues": [] },
  "created": "2026-10-13T12:00:00.000Z",
  "updated": "2026-10-13T12:00:00.000Z"
}
```

## Kinds

| Kind | For | Delivered as |
|---|---|---|
| `trap` | Something that breaks, and how to avoid it | `[TRAP]` |
| `decision` | A project choice, with why | `[DECISION]` |
| `failed_approach` | Something tried and abandoned | `[ABANDONED]` |
| `procedure` | Steps to follow for a recurring task | `[PROCEDURE]` |
| `fact` | A fact about the project or its environment the code does not show | `[FACT]` |

## Fields

| Field | Meaning |
|---|---|
| `topic` | `area/subject` path; at most one live memory per topic |
| `title`, `body` | What the agent reads: title up to 200 characters, body up to 1,500 |
| `not_derivable` | Why an agent reading the code, tests and docs would not work this out (up to 300 characters); required for a live memory |
| `triggers` | When DD delivers it (below) |
| `check` | An optional rule DD checks the agent's changes against (below) |
| `evidence` | `file` (a repository path DD hashes), `observation`, `correction` or `note`, each with a summary |
| `origin` | `model_initiated` (the agent decided) or `user_explicit` (a person asked or edited it) |
| `replaces` | The live memory a candidate revises; accepting it supersedes that one |
| `revisit_when` | Conditions under which the memory should be reviewed again |

## Triggers

A trigger clause names the events it applies to in `on`: `prompt`, `read`, `edit`, `write`, `search` or
`run`. At least one more field narrows it:

- `paths`: globs of repository files the event touches (`*`, `**`, `?` and `{a,b}` alternatives);
- `symbols`: identifiers the edited or written text contains;
- `commands`: words of a command the agent runs;
- `keywords`: words or phrases of the prompt or tool call;
- `not`, `not_paths`: phrases or globs that cancel the clause.

A memory fires when any of its clauses matches. `deltadictum health` and the review UI report triggers that
can never fire (a glob with no file, a symbol absent from the code) and globs so broad they match much of
the repository.

## Checks

A check states a rule DD verifies itself:

| Field | Meaning |
|---|---|
| `on` | `edit`, `write` or `run` |
| `paths` | The files it applies to (edit and write) |
| `if_content`, `unless_content` | A violation when the changed file matches the first and not the second |
| `if_command`, `unless_command` | The same over a command |
| `when` | `turn` (the default for files: once, at the end of the turn), `edit` or `run` |
| `say` | What the agent is told, up to 200 characters |
| `examples` | `violates` and `passes` samples, required: a check whose examples fail is left out |

DD reports only violations the change introduced, at most twice per file per epoch (a session until its
next compaction or `/clear`), and never runs code.

## Statuses

| Status | Delivered |
|---|---|
| `candidate` | No: waits for review |
| `active` | Yes |
| `contested` | Yes, marked `[DISPUTED]` |
| `superseded` | No: a revision replaced it |
| `archived` | No: retired, merged or archived by a person; restorable |

A memory converted from v1 carries `review.migrated: true` and stays live without `not_derivable` until a
person supplies it in the review UI.
