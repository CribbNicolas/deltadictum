# Configuration

## Project settings: `.dd/config.json`

Commit it to share the settings with your team. Every key is optional, and the file's presence is enough:
a project with a `.dd/` folder (this file, or a first memory) is one DD records and asks in; one without
is left alone. `deltadictum init` writes it with the project id, beside `.dd/.gitignore` and
`.dd/memories/`.

| Setting | Default | What it does |
|---|---|---|
| `auto_accept` | on | `false` (or `{ "enabled": false }`) sends every proposal to review instead of activating those backed by evidence DD verified |
| `retire.after_sessions` | `20` | How many sessions must touch a memory's files without it firing before maintenance retires it |
| `project_id` | the existing memories' id, else the folder name | The project id written into new memories |

For example, to review every proposal yourself:

```json
{ "auto_accept": false }
```

A memory a person reviewed is never retired automatically, whatever `retire.after_sessions` says.

## Environment variables

| Variable | Effect |
|---|---|
| `DD_MAINTENANCE=0` | Session start does not start the daily maintenance run (tests and CI set it) |
| `DD_CAPTURE_PAYLOADS=<file>` | Appends every hook payload to that file, to check a harness's payload shapes |
