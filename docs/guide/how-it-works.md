# How DD works

DD runs inside the coding-agent harness: hooks on the harness's events, a local MCP server and one
background process per machine, the [resident](resident.md). Knowledge is stored as JSON files in the
project's `.dd/` directory, reviewed and shared through git.

## The loop

1. **Capture.** While it works, the agent proposes what an agent reading the code would miss: when it
   applies, what to do differently, why, the evidence and the anchor keywords (see
   [memories](memories.md)). DD validates the proposal, hashes the evidence it can verify and files a
   candidate.
2. **Review.** A person approves, rejects or sends back each candidate in the local audit UI.
   [Auto-accept](configuration.md#auto-accept-threshold-values) admits a candidate without waiting when
   the evidence DD verified is strong enough. It is on by default.
3. **Recall.** Before each prompt and tool call, hooks push the memories that apply, within a token budget,
   and point at near misses the agent can pull.

## What the agent receives

- **At session start: a memory map.** Every live memory by topic and title, once per session and again
  after compaction. When the map outgrows its budget, it is grouped by domain. The agent pulls any line
  that applies with `get`. This is the one delivery every harness supports.
- **Before each prompt and tool call: pushed memories.** Some memories are pushed whatever their rank:
  - one of its anchor keywords appears in the request as whole words (case and accent insensitive);
  - the request reads or edits one of its anchor files;
  - the request names one of its components.

  Otherwise a memory competes on meaning and wording: full-text (BM25) and embedding rankings, fused.
  `not_when` phrases keep a memory out either way. Each memory arrives in the most compact form that fits
  the budget (`budget_tokens`, 800 estimated tokens by default), down to a flagged headline with its id.
- **Pointers.** Up to eight near misses per event, as one line each:
  `topic_key — when it applies (get id)`. Each memory is pointed at once per session.
- **Ambient memories.** Memories tagged `ambient` arrive once per session, at session start.

A prompt that is not in English also carries a line asking the agent to call `retrieve` with the task in
English, since memories are matched in English. Harness tools that carry no project work (skill loading,
web search, subagent hand-backs and similar) trigger no retrieval at all.

OpenCode has no per-tool-call hook, so there the context arrives once per session and recall goes through
the MCP tools.

## MCP tools

| Tool | Does |
|---|---|
| `orient` | Project facts, structure, source pointers and the knowledge relevant to the coming action |
| `retrieve` | The memories that apply to an action; its five best are returned even below their floors |
| `get` | One memory in full: rationale, alternatives, evidence and its freshness |
| `propose` | Files lessons or decisions as candidates for review, with no count limit |
| `feedback` | Records an outcome for a memory: `helped`, `failed`, `refuted` or `not_applicable` |
| `act` | Requests a store change (archive, merge, legacy…) for a person to apply |
| `similar` | The memories nearest to a memory or a text, to spot overlaps before proposing |
| `contradict` | Flags two effective memories as disputed, without choosing a winner |
| `list`, `status`, `health` | Audit listings, counts and the deterioration report |
| `ui` | The audit UI address |

The agent cannot approve, resolve or delete anything: those operations are not exposed to it.

## Commands

On Claude Code the commands are `/dd:<name>`. Codex installs them as project skills named `dd-<name>`, and Grok
Build lists them under the `deltadictum` plugin.
Every change a command makes is a pending proposal or action that you apply in the audit UI.

| Command | Does |
|---|---|
| `/dd:recall` | Recalls the knowledge for the current task |
| `/dd:save` | Saves a lesson or decision from the conversation |
| `/dd:audit` | Inspects knowledge, evidence, pending revisions and outcomes, and opens the audit UI |
| `/dd:review [id]` | Works through revision requests and memories whose evidence changed |
| `/dd:compact` | Finds memories that repeat or overlap and files merges |
| `/dd:clean` | Reviews the archive and files restores or deletions |
| `/dd:prospect <area>` | Looks for knowledge in one area and proposes only what is new |
| `/dd:init` | Deep first survey of a project; states the cost and waits for a yes |

You can also ask in plain words: "merge these two", "that practice is dead, mark it legacy".

## Feedback and capture

The hooks keep small local records, never knowledge:

- **Observations.** Failing commands, and validations: a test, lint or type-check run whose output reports
  no failures. Ordinary reads and unrelated successful commands are discarded.
- **User corrections.** A prompt with corrective language is recorded as an observation. The detection is
  a deterministic English/Spanish rule.

A proposal may cite these records as evidence, which raises the confidence it can reach. The Stop hook
reminds the agent to capture only after a turn that recorded a failure, a validation or a correction, and
at most once per turn.

Outcomes reported through `feedback`, and how often a memory is retrieved, are telemetry. They never
raise a memory's confidence or authority.

## How it is measured

- **Replay** (`npm run eval`). 28 authored scenarios: exact matches, paraphrases, Spanish requests,
  incompatible scope, changed facts, retired advice and unrelated actions. It currently scores F1 1.0
  with 28 of 28 exact, and costs 84% fewer estimated tokens than loading the same knowledge as static
  instructions. It measures retrieval and context cost, not code quality.
- **Golden sets.** 100 real events from each of two projects, labelled with the memories they needed.
  On the held-out halves, the memories an agent ends up with (pushed plus pulled) cover 0.90 to 0.96 of
  the essential ones with Sonnet as the agent (`npm run bench`, `npm run bench:pull`).
- **Model evaluation.** A provider-neutral [runner](../evaluation/model-evaluation.md) compares no memory,
  static instructions and DD with real model calls supplied by an adapter.

The behavioural contract DD guarantees is [docs/DD.md](../DD.md); the limits it is built within are in
[plugin constraints](../architecture/plugin-constraints.md).
