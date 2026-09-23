# DeltaDictum

DD supplies project context and conditional engineering knowledge to coding agents. It preserves decisions, rationale, assumptions and evidence, then recalls the applicable knowledge before an action.

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.** It runs from hooks and a local MCP server, stores knowledge as git-tracked files in the project it describes, and requires no database engine, no external vector store, no inference server and no cloud account. The seven constraints that follow from being a plugin are stated in [`docs/architecture/plugin-constraints.md`](docs/architecture/plugin-constraints.md).

Version **0.3.0** implements the project cognition contract described in [the architecture](docs/architecture/project-cognition.md). The engine is local and provider independent: no model call, embeddings service or cloud account is required. An optional local embedding model improves recall when the [resident process](#resident-process) runs.

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

The MCP server and the SessionStart hook start this UI as the [resident process](#resident-process) when none is running. Hooks reuse it when it runs the same, unchanged build and fall back to opening the local store. Neither path blocks the host on plugin failure.

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

Automatic capture reminders are separate from writes: the Stop hook reminds only after a turn that recorded a host failure, a validation or a user correction, and avoids repeated continuations within a turn. A new user prompt rearms it, and previously offered host evidence alone does not trigger another reminder. Explicit `propose` calls remain available at any point. Old `capture.max_proposals` settings and exhausted session counters no longer restrict writes.

## Resident process

DD runs one background process per project: the local audit UI, which also answers the hooks. It holds a
multilingual embedding model (`Xenova/multilingual-e5-small`, through the optional dependency
`@huggingface/transformers`) and gives every hook and the MCP `retrieve` tool semantic retrieval. Without it
DD still works: each hook falls back to lexical retrieval in its own process.

- **Who starts it.** The first session that finds none (the SessionStart hook or the MCP server) starts it
  in the background. It is shared by every session on the project and outlives them.
- **When it steps aside.** A process from another DD install, or one whose code changed since it started,
  is replaced at the next session start. It exits after 12 hours without hook traffic.
- **Cost.** About 640 MB of RAM once the model is loaded, about 480 MB on disk for the runtime, and 130 MB
  for the model, downloaded once to `~/.dd-data/models` on first start. A query takes a few milliseconds.

When the session's first message says retrieval is lexical, check in this order:

1. **Is it running?** Open the URL in `<project>/.dd/ui.json` and request `/api/status`. `retrieval` is
   `semantic` when the model is loaded, `loading` during the first start, `lexical` without the runtime.
   `stale: true` means its code changed; the next session replaces it.
2. **Start it by hand:** `node <dd>/src/cli.js ui` from the project directory. It says so and exits if a
   current one is already running.
3. **`retrieval: lexical` while running:** the optional runtime is missing. Reinstall DD's dependencies
   without `--no-optional`/`--omit=optional`. Platforms without prebuilt ONNX binaries (for example Alpine/musl)
   stay lexical.
4. **It never stays up:** run `node <dd>/src/cli.js ui` in a terminal and read the error; a blocked port
   range 7733-7742 or a read-only `~/.dd-data` are the usual causes.

Set `DD_RESIDENT=0` to never start one (CI, tests, or by choice); retrieval is then lexical.

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

Commit these knowledge files to share them with a team. Ignore runtime files `ui.json`, `.write-lock`, `.pending-write.json` and `*.tmp`. DD creates a local ignore file automatically.

SQLite, observations, feedback and session deliveries live under a per-user cache at `~/.dd-data`, in one directory per project identified by its physical path (symlinks resolved; case folded on Windows and macOS), so every process that opens the project reaches the same directory. When a new directory is created, history from earlier locations of the same project is copied into it. `DD_DATA` explicitly overrides that directory; use a separate directory for each project. The cache is rebuildable from git, so deleting it costs local telemetry and no knowledge.

The cache deliberately does **not** live at `~/.dd`. A `.dd` directory marks a project, and when the per-user cache shared that name the home directory resolved as a project root, merging unrelated work into one store. If you used an earlier version, `node scripts/check-home-artifacts.mjs` reports what `~/.dd` still holds and removes it only when asked, and only when it holds no knowledge.

Existing V6 knowledge stays readable. A legacy candidate is relocated on its next lifecycle transition; it cannot replace effective knowledge merely by being proposed. SQLite is rebuilt when its format or source fingerprint changes. The previous v1 observation JSONL is no longer appended; legacy files remain available for manual audit. Version 0.2 uses a separate default cache identity, so v1 local telemetry is not automatically imported.

The MCP write API changed from a single payload to `propose({proposals:[...]})`. `admit`, `resolve`, `reject`, `delete` and `update` are no longer advertised to models. Submit revisions through `propose` and use local review for lifecycle changes.

## Validation

```text
npm test
npm run test:stress
npm run eval
npm run bench             # task benchmark, lexical retrieval
npm run bench:semantic    # the same tasks with embeddings
npm run sync:plugin
```

The replay covers 24 authored scenarios: exact matches, paraphrases, Spanish, incompatible scope, changed facts, retired advice and unrelated actions. It measures retrieval correctness and estimated context cost; it is not evidence of improved code quality across model families.

A provider-neutral [model evaluation runner](docs/evaluation/model-evaluation.md) compares no memory, static instructions and DD while preserving actual usage supplied by an adapter. Real model runs and repository task trials are required before claiming equal effectiveness across models or improved development outcomes.

Imported Orquesta V2–V10 documents are historical design references. The current authority is [docs/DD.md](docs/DD.md); the [implementation plan](docs/plans/2026-09-10-project-cognition.md) maps delivery and validation.
