# Configuration

DD has two layers of settings:

- **Per project**: `.dd/config.json`, committed with the project's knowledge and so shared with everyone
  who works on the repository.
- **Per machine**: a few environment variables, read where DD starts.

Most projects change neither. The defaults are the values DD was measured with (see
[how it works](how-it-works.md#how-it-is-measured)).

## Project settings: `.dd/config.json`

The first time DD opens a project it writes `.dd/config.json` with every default and a generated
`project_id`. Commit it.

There are two ways to change it:

- **The audit UI.** Its **Settings** panel turns auto-accept on or off and moves its threshold. The
  slider offers only the values a candidate can actually reach, each labelled with what it admits.
- **By hand.** A key you leave out takes its default. Inside a block you can set one value without
  restating the others:

  ```json
  { "auto_accept": { "confidence_threshold": 0.85 } }
  ```

A hand edit is picked up within about five seconds, on the next request; nothing needs a restart.

### Common settings

| Key | Default | What it does |
|---|---|---|
| `auto_accept.enabled` | `true` | Admits candidates whose evidence DD verified itself, without waiting for a person. Off, every candidate waits for review in the audit UI. |
| `auto_accept.confidence_threshold` | `0.765` | The confidence a candidate's verified evidence must reach to be auto-accepted. `0.765` admits a model-initiated proposal backed by a repository file, diff or test log DD hashed. See [reachable values](#auto-accept-threshold-values). |
| `budget_tokens` | `800` | Estimated tokens of knowledge pushed per prompt or tool call (UTF-8 bytes / 3). More fits more memories in their fuller forms; MCP calls accept 128 to 8,000. |
| `anchors.only` | not set (`false`) | `true` delivers a memory only when one of its anchors matches (keyword, file or component), never by similarity. Deterministic, at the cost of recall. |
| `semantic.floor` | `0.035` | How far above the query's mean similarity a memory must stand to be pushed by meaning. Lower reaches terse memories more often and adds noise. |
| `auto_apply_retrieval_metadata` | `true` | An agent's `anchor` action (new anchors or trigger variants, the advice unchanged) applies itself once validated. `false` makes it wait for a person like every other action. |
| `archive_review_at` | `50` | Past this many archived memories, the session start asks the agent to offer a cleanup (`/dd:clean`). |

### Auto-accept threshold values

A candidate's confidence ceiling comes from the most reliable evidence DD verified for it, scaled by
0.9 when the agent proposed it on its own initiative (`model_initiated`). Evidence volume does not raise
it. The ceilings a candidate can reach:

| Threshold | Admits automatically |
|---|---|
| `0.45` | Any autonomous proposal, even with nothing verified |
| `0.5` | Any proposal the user asked to save, even with nothing verified |
| `0.63` | An autonomous proposal backed by a recorded host observation (a failing command, a test run) |
| `0.7` | A requested save backed by a host observation |
| **`0.765`** | **An autonomous proposal backed by a repository file, diff or test log DD hashed (default)** |
| `0.85` | A requested save backed by a repository artifact |
| `0.855` | An autonomous proposal backed by an observed user correction |
| `0.95` | Only a requested save backed by an observed user correction |

Turning auto-accept off, or raising the threshold, sends more candidates to review. Every memory
auto-accept admits records `Auto-accepted: confidence … >= threshold …` as its review rationale, so the
audit UI shows which memories no person read.

### Local data retention

Observations, telemetry and session deliveries are local SQLite data, never committed. These keys bound
them; `deltadictum maintain` applies them immediately.

| Key | Default | What it bounds |
|---|---|---|
| `capture.retention_days`, `capture.max_observations` | `14`, `200` | Recorded host observations (failures, validations, user corrections) |
| `telemetry.retention_days`, `telemetry.max_events` | `90`, `2000` | Retrieval and outcome events, per table |
| `session.retention_hours`, `session.max_entries` | `24`, `500` | Which memories each session already received |

### Advanced

| Key | Default | What it does |
|---|---|---|
| `vpt_threshold` | `0.02` | Minimum marginal value for a memory to join a pack, after redundancy with memories already in it. |
| `health.*` | see below | Thresholds of the deterioration report (`health` tool, `deltadictum health`, audit UI). |
| `defaults_version` | `2` | Written by DD. A config without it reads values equal to old defaults as unset, so improved defaults reach it. Do not edit. |
| `project_id` | generated | The project's identity in the local index. Do not edit. |

`health` thresholds (each has a `watch` and a `deteriorated` level):

| Key | Default | Reports |
|---|---|---|
| `live_bloat` | 80 / 200 | Effective memories in the project |
| `prefix_crowding` | depth 2, 12 / 25 | Memories under one topic prefix |
| `trigger_collision` | Jaccard 0.5, 1 / 8 | Pairs of memories with near-identical triggers |
| `dead_inferred` | 14 days, 5 / 20 | Unreviewed memories never activated |
| `unresolved_contest` | 7 days, 1 / 3 | Disputes left open |
| `supersession_churn` | 3 / 5 | Topics revised again and again |
| `cap_saturation` | last 50 events, min 10, 0.2 / 0.5 | Share of retrievals that filled the budget |
| `retirement` | 90 days, 40 retrievals | When an unreviewed, never-activated memory is archived by disuse |

## Machine settings: environment variables

Set these where DD starts: the harness's environment, or the shell that runs `deltadictum`. The resident
reads its own variables when it starts, so restart it after a change (`deltadictum resident` after
stopping it, or let the next session start replace it).

| Variable | Default | What it does |
|---|---|---|
| `DD_PROJECT_DIR` | the host's working directory | The project the MCP server serves. Needed when the host starts the server from another directory (OpenCode, other MCP hosts). |
| `DD_DATA` | `<data base>/<project>-<hash>` | The project's local data directory (SQLite index, telemetry). The data base is the harness's plugin data directory under Claude Code and Grok Build, `~/.dd-data` elsewhere; the Codex installer sets `<project>/.dd/local`. Use a separate directory per project. |
| `DD_EMBED_MODEL` | `multilingual-e5-small` | `multilingual-e5-base` loads the larger model: about 175 MB more memory and 30% slower per query, with no measured recall gain. |
| `DD_RESIDENT` | on | `0` never starts the resident, which leaves DD inactive. For tests. |
| `DD_RESIDENT_REGISTRY` | `~/.dd-data/resident.json` | Where the resident is recorded. Tests point it at a temporary file so they never replace the machine's resident. |
| `DD_RETRIEVAL` | semantic | `lexical` runs without the embedding model. For tests and evaluation only. |
