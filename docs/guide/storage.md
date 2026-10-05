# Storage

## Knowledge: `.dd/` in the project

```text
<project>/.dd/
  atoms/<topic_key>.json      effective memories (active, contested)
  candidates/<id>.json        pending proposals
  legacy/<id>.json            abandoned practices, recalled as warnings
  archive/<id>.json           superseded, archived and rejected versions
  actions/<id>.json           store changes the agent filed, pending review
  registry/topics.json        topic keys and domains
  relations.json              supersession and dispute relations
  config.json                 project settings (see configuration.md)
```

- **Committing.** Commit these files to share knowledge with a team; git is the authority for knowledge.
  DD writes a `.dd/.gitignore` for its runtime files (`.write-lock`, `.pending-write.json`, `*.tmp`).
- **Writes.** Git writes use a recoverable journal and a project lock, so an interrupted write is
  completed or rolled back on the next open. Deleting an old version checks its identity before touching
  any current file.

## Local data: per user, per project

Several things are local and never committed:

- the SQLite index (full-text and vectors);
- observations, telemetry and session deliveries.

They live in one directory per project under a per-user base:

- under Claude Code and Grok Build, the harness's plugin data directory;
- elsewhere, `~/.dd-data`.

The directory is identified by the project's physical path, with symlinks resolved and case folded on
Windows and macOS, so every process that opens the project reaches the same directory. When a new
directory is created, history from earlier locations of the same project is copied into it. `DD_DATA`
overrides it; use a separate directory for each project.

The index is rebuilt from git whenever its format or the knowledge files change, so deleting the local
directory loses only local telemetry, never knowledge. `deltadictum reindex` rebuilds it on demand.

The per-user base deliberately does **not** live at `~/.dd`. A `.dd` directory marks a project, and when the
cache shared that name the home directory resolved as a project root, merging unrelated work into one
store.

## Schema and unreadable files

DD reads only knowledge files in its current schema (version 7) with a valid `capture_origin` and
`capture_source`. Some files fail that check: an older schema, missing provenance, or invalid JSON. Such
a file is never indexed or recalled and cannot be overwritten. `health` and the audit UI list it with its
reason, so a person can fix or delete it.

Agents write knowledge only through `propose` and request store changes only through `act`. Admission,
resolution and deletion happen in the audit UI.
