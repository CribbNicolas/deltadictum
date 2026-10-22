---
title: Configuration
description: "Every DeltaDictum setting, all changed from the review UI: the project's, committed in .dd/config.json, and this machine's, kept in .dd/local/settings.json."
parent: Reference
nav_order: 3
---

# Configuration

Every setting is changed in the review UI's Settings panel (the button at the foot of its sidebar), which
validates it, keeps every other key of the file as it is, and recompiles when the change needs it.
Editing the files by hand works too.

## The project: `.dd/config.json`

Committed with the repository, so the team shares it. Every key is optional, and the file's presence is
enough: a project with a `.dd/` folder (this file, or a first memory) is one DD records and asks in; one
without is left alone. `deltadictum init` writes it with the project id, beside `.dd/.gitignore` and
`.dd/memories/`.

| Setting | Default | What it does |
|---|---|---|
| `auto_accept` | on | `false` (or `{ "enabled": false }`) sends every proposal to review instead of activating those backed by evidence DD verified |
| `delivery_limit` | 10000 | The cap of one delivery, in characters (2,000 to 50,000); what does not fit whole is named and arrives at its next event. By hand, run `deltadictum compile` after the change |
| `retire.after_sessions` | 20 | How many sessions must touch a memory's files without it firing before maintenance retires it (1 to 1,000). A memory a person reviewed is never retired this way |
| `project_id` | the folder's name | The label written into new memories; the memories already saved keep theirs |

For example, to review every proposal yourself:

```json
{ "auto_accept": false }
```

## This machine: `.dd/local/settings.json`

What one person turns on or off for themselves, never committed (`.dd/local/` is git-ignored).

| Setting | Default | What it does |
|---|---|---|
| `maintenance` | on | `false`: session start no longer starts the daily maintenance run; `deltadictum maintain` runs it by hand |
| `record_payloads` | off | `true`: every hook appends what the harness sent it to `.dd/local/payloads.jsonl`, to check a harness against a real session. Turn it off when done; the file grows with every tool call |

Two environment variables do the same for one process, where no file can: `DD_MAINTENANCE=0` keeps CI and
DD's own tests from starting maintenance, and `DD_CAPTURE_PAYLOADS=<file>` records payloads into that file,
also in a project that has not opted in.
