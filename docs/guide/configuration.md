---
title: Configuration
description: "The settings of .dd/config.json, the file that opts a project into DeltaDictum, all changed from the review UI; and the two environment switches for one process."
parent: Reference
nav_order: 3
---

# Configuration

## Project settings: `.dd/config.json`

Commit it to share the settings with your team. Every key is optional, and the file's presence is enough:
a project with a `.dd/` folder (this file, or a first memory) is one DD records and asks in; one without
is left alone. `deltadictum init` writes it with the project id, beside `.dd/.gitignore` and
`.dd/memories/`.

Every setting is changed in the review UI's Settings pane (the gear beside the DD logo), which validates
it, keeps every other key of the file as it is, and recompiles when the change needs it. Editing the file
by hand works too.

| Setting | Default | What it does |
|---|---|---|
| `auto_accept` | on | `false` (or `{ "enabled": false }`) sends every proposal to review instead of activating those backed by evidence DD verified |
| `delivery_limit` | 10000 | The cap of one delivery, in characters (2,000 to 50,000); what does not fit whole is named and arrives at its next event. By hand, run `deltadictum compile` after the change |
| `retire.after_sessions` | 20 | How many sessions must touch a memory's files without it firing before maintenance retires it (1 to 1,000). A memory a person reviewed is never retired this way |

For example, to review every proposal yourself:

```json
{ "auto_accept": false }
```

`project_id` is the id written into new memories: by default the existing memories' id, else the folder's
name. The Settings pane shows it but does not change it, because memories already written keep the old
one.

## Switches for one process

Two environment variables change what DD does in the process that has them, not in the project. They are
not settings because they must not travel with the repository: a committed switch would turn every
teammate's maintenance off, or record every teammate's payloads.

| Variable | Effect | Who sets it |
|---|---|---|
| `DD_MAINTENANCE=0` | Session start does not start the daily maintenance run | Tests and CI, which must not spawn a detached process |
| `DD_CAPTURE_PAYLOADS=<file>` | Every hook appends its command and payload to that file | Whoever checks what a harness really sends, for one session, then unsets it |
