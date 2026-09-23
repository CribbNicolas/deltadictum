# DeltaDictum

DD supplies project context and conditional engineering knowledge to coding agents. It preserves decisions, rationale, assumptions and evidence, then recalls the applicable knowledge before an action.

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.** It runs from hooks and a local MCP server, stores knowledge as git-tracked files in the project it describes, and requires no database engine, no external vector store, no inference server and no cloud account. The seven constraints that follow from being a plugin are stated in [`docs/architecture/plugin-constraints.md`](docs/architecture/plugin-constraints.md).

Version **0.3.0** implements the project cognition contract described in [the architecture](docs/architecture/project-cognition.md). The engine is local and provider independent: no model call, embeddings service or cloud account is required. Retrieval uses a local embedding model held by the [resident process](#resident-process); without it DD is inactive and says why.

## What the agent receives

- `orient`: bounded manifest facts, repository structure, source pointers and relevant decisions.
- `retrieve`: action-specific advice, including applicability conditions and explicit dispute/review notices.
- `get`: the rationale, alternatives and evidence for a particular memory.

The default retrieval budget is **600 estimated tokens for the JSON result**, including metadata. Estimates use UTF-8 bytes/3; actual token counts depend on the model tokenizer. MCP accepts budgets from 128 to 8,000. Unchanged advice is suppressed within an explicitly supplied session ID; use `repeat: true` after context compaction.

## Knowledge lifecycle

`propose` accepts batches of independent lessons with no proposal count limit per call or session. Capture supported decisions at meaningful checkpoints, including during long sessions; larger transfers can use multiple calls. DD derives compact forms from the authored statement. Every new proposal remains a candidate until local review, including anti-memories.

Each memory records `capture_origin`: `model_initiated` or `user_explicit` (the user asked to save that knowledge). Missing origins default to `user_explicit`, including older memories. Agents and capture hooks explicitly mark autonomous discoveries as `model_initiated`. `capture_source` records the engine's entry point: `agent` or `local_ui`; an absent historical channel remains `unknown`. Capture origin is not proof of human approval. Audit lists and the UI can filter by origin.

An existing active decision remains effective while a replacement is pending. Approval publishes the new decision and archives the old version together. Git writes use a recoverable journal and a project lock. Deleting an old version checks its identity before touching any current file.

Local evidence references receive content hashes computed by DD. A verified file means the artifact exists and its bytes were checked; it does not establish that the lesson follows logically. The local reviewer assesses that support and records a rationale. Model-supplied approval labels and hashes cannot authorize promotion through MCP.

Changes to verified files keep the advice visible, flagged `EVIDENCE CHANGED`; revision conditions or supported counterevidence produce a review notice. Memories tagged `ambient` reach every session once, at session start. Contradictions remain visible in both tool results and hooks.

## Quick start

For a local Codex project, use the [Codex installer and verification guide](docs/integrations/codex.md). It configures MCP, skills and hooks for the selected project.

Install dependencies with `npm install`, then register this entrypoint with the host's MCP configuration:

```json
{
  "command": "node",
  "args": ["<absolute-plugin-path>/src/mcp/server.js"],
  "env": { "DD_PROJECT_DIR": "<absolute-project-path>" }
}
```

Use an absolute script path. `DD_PROJECT_DIR` identifies the consuming project independently of the plugin's working directory. If omitted, the consuming project's cwd is used. Host-provided hook cwd takes precedence for that hook.

The repository includes root/nested plugin manifests, hooks, and [generic host instructions](adapters/AGENTS.md). Native host installation and hook event support must be verified in each host; the automated suite checks DD's MCP protocol and hook processes.

Run the standalone audit UI from the target project:

```text
node <absolute-plugin-path>/src/cli.js
```

The MCP server and the SessionStart hook start this UI as the [resident process](#resident-process) when none is running. Hooks use it when it runs the same, unchanged build; otherwise they recall nothing, keep recording capture bookkeeping, and SessionStart says DD is inactive. Neither path blocks the host on plugin failure.

## Propose a decision

```json
{
  "session_id": "host-session-id",
  "proposals": [{
    "memory_type": "decision",
    "capture_origin": "model_initiated",
    "topic_key": "payments/retry/idempotency",
    "trigger": "when retrying payment requests",
    "behavior_delta": "Reuse the original idempotency key.",
    "why": "The provider may have accepted the first request before its response timed out.",
    "applies_to": { "components": ["payments"] },
    "assumptions": [{
      "key": "provider.idempotency",
      "equals": true,
      "description": "The provider supports idempotency keys."
    }],
    "revisit_when": [{
      "kind": "file_changed",
      "path": "docs/payment-provider.md",
      "description": "The provider contract changes."
    }],
    "evidence_refs": [{
      "source_type": "file",
      "source_ref": "docs/payment-provider.md",
      "summary": "Provider retry contract"
    }]
  }]
}
```

Required authored fields: `topic_key`, `trigger`, `behavior_delta`, `why`, `evidence_refs`. Type defaults to `lesson`; title and compact forms are derived. A same-topic proposal requests a revision. Agent tools do not expose approval, resolution or deletion; use the local review UI.

## Feedback and capture

`feedback` records an outcome for a memory and task: `helped`, `failed`, `refuted` or `not_applicable`. Retrieval frequency and agent-reported success never raise confidence or authority. A task ID prevents repeated submission of the same outcome from inflating counts.

Hooks retain small failure diagnostics and explicit validation results. Ordinary reads and successful unrelated commands are discarded. Observations and telemetry are local SQLite data with configurable retention (defaults: 200 observations/14 days, 2,000 telemetry events per table/90 days). `node src/cli.js maintain` applies retention immediately.

Automatic capture reminders are separate from writes: the Stop hook reminds only after a turn that recorded a host failure, a validation or a user correction, and avoids repeated continuations within a turn. A new user prompt rearms it, and previously offered host evidence alone does not trigger another reminder. Explicit `propose` calls remain available at any point.

## Resident process

DD requires one background process per machine, shared by every project and session: the resident. It
holds a multilingual embedding model (`Xenova/multilingual-e5-small`, through `@huggingface/transformers`)
and answers the hooks, the MCP `retrieve` tool and the audit UI for each project from that project's own
store and data directory. **Until it is running with its model loaded, DD is inactive**: nothing is
recalled, and the session's first message says why.

- **Who starts it.** The first session or MCP server that finds none starts it in the background. It is
  recorded in `~/.dd-data/resident.json` and outlives the sessions that use it.
- **Several projects.** Each project is opened the first time one of its hooks asks, with its own SQLite
  store; the model is loaded once for all of them. The audit UI is per project:
  `http://127.0.0.1:<port>/?project=<key>` (the session banner prints it). Without `?project=` the page
  lists the open projects.
- **When it steps aside.** A process from another DD install, or one whose code changed since it started,
  is replaced at the next session start. It exits after 12 hours without hook traffic.
- **Cost.** About 640 MB of RAM with the model loaded, plus little per open project (two projects measured
  724 MB); about 480 MB on disk for the runtime and 130 MB for the model, downloaded once to
  `~/.dd-data/models`. A query takes a few milliseconds.

When the first message says DD is inactive, check in this order:

1. **Is it running?** Open the `url` in `~/.dd-data/resident.json` and request `/api/resident`.
   `retrieval` is `semantic` when ready, `loading` while the model loads (the first run downloads it), and
   `unavailable` when the model could not be loaded. `stale: true` means its code changed; the next session
   replaces it.
2. **Start it by hand:** `node <dd>/src/cli.js resident`. It says so and exits if a current one is running.
3. **`retrieval: unavailable`:** the embedding runtime is missing or cannot run here. Reinstall DD's
   dependencies; platforms without prebuilt ONNX binaries (for example Alpine/musl) cannot run DD.
4. **It never stays up:** run `node <dd>/src/cli.js resident` in a terminal and read the error; a blocked
   port range 7733-7742 or a read-only `~/.dd-data` are the usual causes.

`DD_RESIDENT=0` never starts one, which leaves DD inactive. `DD_RETRIEVAL=lexical` runs retrieval without
the model and exists only for tests and evaluation.

## Storage and migration

```text
<project>/.dd/
  atoms/<topic_key>.json       effective decisions
  candidates/<id>.json        pending proposals
  archive/<id>.json           historical/rejected versions
  registry/topics.json
  relations.json
  config.json
```

Commit these knowledge files to share them with a team. Ignore runtime files `.write-lock`, `.pending-write.json` and `*.tmp`. DD creates a local ignore file automatically.

SQLite, observations, feedback and session deliveries live under a per-user cache at `~/.dd-data`, in one directory per project identified by its physical path (symlinks resolved; case folded on Windows and macOS), so every process that opens the project reaches the same directory. When a new directory is created, history from earlier locations of the same project is copied into it. `DD_DATA` explicitly overrides that directory; use a separate directory for each project. The cache is rebuildable from git, so deleting it costs local telemetry and no knowledge.

The cache deliberately does **not** live at `~/.dd`. A `.dd` directory marks a project, and when the per-user cache shared that name the home directory resolved as a project root, merging unrelated work into one store.

Knowledge written with schema version 6 stays readable; a schema-6 candidate is relocated on its next lifecycle transition, and it cannot replace effective knowledge merely by being proposed. SQLite is rebuilt when its format or source fingerprint changes.

Models write only through `propose({proposals:[...]})`; `admit`, `resolve`, `reject`, `delete` and `update` are not advertised to them. Submit revisions through `propose` and use local review for lifecycle changes.

## Validation

```text
npm test
npm run test:stress
npm run eval
npm run bench             # task benchmark, lexical retrieval
npm run bench:semantic    # the same tasks with embeddings
```

The replay covers 24 authored scenarios: exact matches, paraphrases, Spanish, incompatible scope, changed facts, retired advice and unrelated actions. It measures retrieval correctness and estimated context cost; it is not evidence of improved code quality across model families.

A provider-neutral [model evaluation runner](docs/evaluation/model-evaluation.md) compares no memory, static instructions and DD while preserving actual usage supplied by an adapter. Real model runs and repository task trials are required before claiming equal effectiveness across models or improved development outcomes.

The current authority is [docs/DD.md](docs/DD.md).

## License

DD is source-available under the [PolyForm Shield License 1.0.0](LICENSE), not an open-source license.
You may install and use it for any purpose, including in paid work and inside a company, and you may
change it and share copies with the license attached. You may not sell it, offer it as a hosted or
managed service, or use it to provide any product that competes with DD. For other terms, contact the
author through the [repository](https://github.com/CribbNicolas/deltadictum).
