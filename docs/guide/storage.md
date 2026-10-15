---
title: Storage
parent: Reference
nav_order: 4
---

# Storage

Everything DD keeps for a project lives in its `.dd/` folder.

| Path | In git | Holds |
|---|---|---|
| `.dd/memories/<id>.json` | Yes | The memories: the knowledge itself |
| `.dd/memories/manifest.json` | No | A count and hash of the memories, rebuilt when they change |
| `.dd/config.json` | Yes | Project settings ([Configuration](configuration.md)); its presence, or a first memory, opts the project in |
| `.dd/.gitignore` | Yes | Keeps the paths below out of git; DD writes it |
| `.dd/inbox/` | No | Proposals the agent writes; DD deletes each one it stores and keeps a rejected one for the agent to fix |
| `.dd/local/v2/` | No | The compiled index and memory bodies, rebuilt when the memories change |
| `.dd/local/sessions/` | No | Per-session delivery ledgers and footprints, rolled up and pruned after seven days |
| `.dd/local/telemetry/` | No | Check outcomes and ingestion outcomes, one JSON line each, rolled up into the database below |
| `.dd/local/telemetry.sqlite` | No | Counters (fires by dimension, touches, capture signals, inbox outcomes), the similarity index and check outcomes, for health and retirement |
| `.dd/local/requests/` | No | The agent's requests waiting for a person in the review UI |

Writes to `.dd/memories/` go through one journaled transaction (`.dd/.pending-write.json`, under
`.dd/.write-lock`), so an interrupted write is completed before the next one. Losing `.dd/local/` loses
history counters, never knowledge: the index is rebuilt from the memories.

A v1 store (`.dd/atoms/`, `candidates/`, `archive/`, `legacy/`, `registry/`, `actions/`) is converted by
`deltadictum migrate`, which removes those folders once the memories are written.
