# Actions and the legacy state — design

Date: 2026-09-24. Status: approved in conversation 2026-09-24; plugin rename to `dd` pending confirmation.

## Intent

The person manages the memory store by commanding the agent in chat ("merge these two", "archive
everything about the old installer", "that practice is dead, mark it legacy") and approving each resulting
change in the audit UI. The agent never changes the store itself: it files an **action**, a pending,
reviewable request, and nothing moves until the person applies it in the UI. The UI runs in the project
(the resident) and stays the only place where anything is accepted, memories or actions.

A new lifecycle state, **legacy**, records practices the project has left behind: guidance that once held
and must not be followed again. It reaches the agent as a warning.

Success: every store-maintenance operation the person does by hand today can be requested from chat as an
action, reviewed with a before/after view, and applied or rejected in one step; legacy knowledge warns the
agent exactly when nothing current covers the same ground.

## Lifecycle after this change

| State | Answers | Reaches the agent | Stored |
|---|---|---|---|
| `candidate` | what is pending? | no | `.dd/candidates/<id>.json` |
| `active`, `contested` | what do I do? | yes | `.dd/atoms/<topic>.json` |
| `superseded` | where did this come from? | no (UI, `get`) | `.dd/archive/<id>.json` |
| `legacy` | what must not be done again? | yes, as a warning, when nothing current covers it | `.dd/legacy/<id>.json` |
| `archived` | what stopped being useful? recoverable | no | `.dd/archive/<id>.json` |
| `rejected` | what was turned down? | no | `.dd/archive/<id>.json` |

Transitions added: `active | contested | superseded → legacy` (action), `legacy → active` (restore, like an
archived memory, only if its topic is free). Everything else is unchanged. `legacy` differs from
`anti_memory`: that type is authored as "do not" from the start; a legacy memory was once "do" and records
why it was abandoned and what replaced it.

A legacy atom carries `legacy_reason` (required: why the practice was abandoned), `legacy_at`, and
`replaced_by` (optional: the id of the memory that now covers the ground).

Every archived atom carries `archived_reason` as readable text, required on every path into `archived`:
the disuse sweep writes its own ("never activated in N retrievals since <date>"), a merge writes "merged
into <id>", and an `archive` action carries the reason the agent gave. Atoms archived before this change
show "reason not recorded" and keep their old code value.

## Legacy recall

Legacy atoms join the retrieval candidates alongside `active` and `contested`, scored the same way. A
selected legacy memory is **skipped** when the pack already holds its `replaced_by` memory or any memory
with the same `topic_key`: the current guidance is enough. Otherwise it is injected in micro form:

`[LEGACY <id>] No longer done: <micro>. Abandoned because: <legacy_reason>. Now: <replaced_by or "no replacement recorded">.`

It counts against the same budget and session dedup as any memory. It never outranks a current memory:
ranking is unchanged, and it is filtered after selection, not boosted.

## Actions

### Model surface

One new MCP tool, `act`, taking `{ actions: [...], session_id? }`. Each action has `kind`, `rationale`
(required, English), optional `evidence_refs`, and kind-specific fields. The call validates and stores each
action as `pending`; it returns ids and never implies approval. No tool applies, rejects or edits an action.

| Kind | Targets (allowed states) | Fields | On apply |
|---|---|---|---|
| `archive` | 1–50 of active, contested, superseded, legacy | `archived_reason` | targets → `archived` |
| `restore` | 1–50 archived or legacy | — | targets → `active`; refused per target whose topic is taken |
| `delete` | 1–50 archived, rejected or candidate | — | files removed; audit row kept |
| `legacy` | 1–50 active, contested or superseded | `legacy_reason`, optional `replaced_by` | targets → `legacy` |
| `merge` | 2–10 of active, contested, superseded or legacy | `result`: a full proposal | `result` is admitted (reviewed); each source moves one step down (below) |
| `split` | 1 active or contested | `results`: 2–5 proposals | results become active; source → `superseded` |
| `retopic` | 1 active or contested | `topic_key` | moved to the new topic; registry alias from the old key |
| `resolve` | 2 contested, disputing each other | `winner`, `loser_state`: superseded or legacy | as UI resolve, loser to the chosen state |

**Merge moves each source one step down**, whatever mix of states it has:

| Source state | After merge | Link |
|---|---|---|
| `active`, `contested` | `superseded` | `superseded_by` = result |
| `superseded` | `archived` | `archived_reason` = "merged into <result id>" |
| `legacy` | `archived` | `archived_reason` = "merged into <result id>" |

The result is `active`, unless every source is `legacy`: then the result is one consolidated `legacy`
memory, and the action must carry its `legacy_reason`. A mix of legacy and non-legacy sources is refused
(a practice cannot be both current and abandoned). The result names its `topic_key`, like any
proposal; a topic held by a memory outside the merge is refused.

Content revisions (trigger, scope, tags, wording) stay with `propose` on the same `topic_key`, which already
creates a reviewed replacement; `act` does not duplicate it.

`merge` and `split` results go through the same admission checks as a proposal (language, credentials,
injection text, required fields), at filing time, so a pending action is always applicable content-wise.

### Storage

A pending action is a file, `.dd/actions/<id>.json`, like a candidate: visible in git, reviewable by the
team. It records the kind, fields, rationale, evidence, `capture_source`, `created_at`, and a **snapshot**:
each target's id and revision (`updated_at` + `lifecycle_state`). Applying or rejecting removes the file and
writes a row to the audit log (the table that already keeps contradiction history, retained as audit):
action id, kind, targets, outcome, actor `local_ui`, time.

### Review and apply (UI)

A new **Actions** view lists pending actions with their rationale and, per kind, a before/after view: the
targets with their current state and the state each will take; for `merge` and `split`, the source
memories beside the resulting ones; for `resolve`, both sides. Three buttons: Apply, Reject (optional
note) and **Request revision** (required reason). A count of pending actions shows next to the
pending-candidates count.

Apply is all-or-nothing, in one store transaction (`commitAtoms`). Before applying, every target is
compared with its snapshot; if any changed, nothing is applied and the action is marked
`stale: review again` in the UI (the model can file a new one). Same rule for a `replaced_by` or `winner`
that is no longer effective.

Actions are never auto-accepted: the auto-accept sweep reads candidates only, and stays that way.

### Revision requests (actions and candidate memories)

Request revision exists for pending actions and for candidate memories alike. It records
`revision_requested: { reason, at }` on the pending item, which stays pending and cannot be applied or
admitted until revised. The UI shows it as "revision requested".

The reason reaches the agent through the hooks, never the hot path: the next `UserPromptSubmit` and every
`SessionStart` in the project inject, once per session and per request,

`DD - Revision requested for <action|memory> <id> (<kind or topic>): <reason>. File a corrected version with revises=<id>.`

MCP `status` also lists open revision requests. The agent answers with `propose` or `act` carrying
`revises: <id>`: the new item is filed as pending, and the one it revises closes as `rejected` with
`revised_by` (a candidate) or leaves the pending list with an audit row (an action). The person then
reviews the corrected version as usual. A revision the agent never files stays visible in the UI; the
person can still reject it.

### Archive cleanup prompt

`config.archive_review_at` (default 50). When the archive holds more archived memories than that, `status`,
`health` and the audit UI say so, and the session start adds one line asking the model to offer the person
a cleanup: a `restore` action for what is still useful and a `delete` action for the rest. This is a
prompt to propose, never a deletion.

## Commands

The person drives memory management with commands; each is a skill (`skills/<name>/SKILL.md`), which
Claude Code exposes as `/dd:<name>` with arguments, Grok Build discovers from `skills/`, and the Codex
installer copies to `.agents/skills/`. A command only tells the agent what to examine and which tools to
call; every change it produces is a pending proposal or action for the audit UI. Each skill ends by
telling the person how many items it filed and giving the audit UI address.

**Plugin name.** Claude Code prefixes plugin commands with the plugin's name, so `.claude-plugin/plugin.json`
changes `name` from `deltadictum` to `dd` (marketplace install becomes `/plugin install dd@deltadictum`; the
npm package and repository keep the name `deltadictum`). The existing skills are renamed to read as
commands: `dd` → `recall`, `dd-audit` → `audit`, `dd-save` → `save`.

| Command | Does |
|---|---|
| `/dd:review <id>` | Works one item. If it has an open revision request, reads the reason and files the corrected version with `revises`. Otherwise checks the memory against the current code and evidence, and files a revision (`propose`), a `legacy` or `archive` action, or reports that it holds. |
| `/dd:review` | Works every open revision request, then every `review_required` memory (changed evidence, due revisit), the same way. |
| `/dd:compact` | Finds memories that overlap or say the same thing (the `similar` tool, same topic area, near-duplicates) and files `merge` actions, each with a result that keeps the widest valid scope; files `retopic` where a topic is misplaced. Reports clusters it chose not to merge and why. |
| `/dd:clean` | Reviews the archive with each memory's `archived_reason`: files one `restore` action for what is still useful and one `delete` action for the rest. Also answers the archive-review prompt. |
| `/dd:prospect <prompt>` | Explores the part of the project the prompt names, compares what it finds with existing memories (`similar`, `retrieve`), and files only what is new: new proposals, or revisions of an existing memory (same `topic_key`) when it improves one. Never duplicates. |
| `/dd:init` | Deep first survey of a project without DD knowledge (below). |

**`/dd:init`.** Before any exploration the skill tells the person that a full survey reads much of the
repository and can cost a lot of model usage, suggests `/dd:prospect <area>` for a narrower search, and
waits for an explicit yes. If the project already has active memories it says how many and asks again.
On a yes it surveys in passes — manifests and build/test commands; architecture and module boundaries;
conventions visible in code and config; documented decisions and their reasons (docs, ADRs, commit
history); traps (workarounds, TODO/FIXME with context, platform-specific code); testing and release
procedures — and files proposals per pass, each with file evidence, keeping only what an agent reading the
code would miss. It ends with a summary per pass and the audit UI address.

**New MCP tool `similar`.** `{ id? , text?, limit? }` returns the nearest memories (any state except
`rejected`) by embedding similarity, answered by the resident like `retrieve`; inactive without it. It is
read-only and serves `/dd:compact` and `/dd:prospect`.

## Boundaries (plugin constraints and invariants)

- Model output never mutates state: `act` only writes a pending file, like `propose`. (Invariants.)
- No hot-path cost: nothing new runs in `PreToolUse` beyond legacy atoms in the existing candidate set (L1).
- Local-first: actions live in `.dd/` and the derived index (L7). No new dependency (L3).
- Legacy injection is advisory and flagged, like any memory; it never blocks a tool call (L4, L5).

## Changes by file (for the plan)

- `src/store/schema.sql`, `src/store/sqlite-index.js`: `legacy` in the CHECK; index format bump.
- `src/store/paths.js`, `src/store/git-file-store.js`: `.dd/legacy/` and `.dd/actions/`.
- `src/engine/lifecycle.js`: legacy transition and restore; `src/engine/actions.js` (new): validate, file,
  snapshot, apply per kind, reject.
- `src/engine/retrieve.js`: legacy candidates and the coverage filter; `src/hooks/session-start.js`
  (`microPack`): the LEGACY flag.
- `src/mcp/definition.js`, `src/mcp/tools.js`: `act`; `revises` on `propose` and `act`; open revision
  requests in `status`.
- `src/hooks/run.js`, `src/ui/server.js` (prompt route), `src/hooks/session-start.js`: deliver revision
  requests once per session.
- `src/engine/lifecycle.js` (`archiveMemory`, `retireByDisuse`): readable `archived_reason` on every path.
- `src/ui/server.js`, `src/ui/public/index.html`: actions routes and view, legacy state filter.
- `src/mcp/*`, `src/ui/server.js` (hook route), `src/hooks/bridge.js`: `similar`, bridged to the resident.
- `skills/`: `recall`, `audit`, `save` (renamed), `review`, `compact`, `clean`, `prospect`, `init`;
  `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`: plugin name `dd`;
  `scripts/install-codex.mjs`: the new skill list.
- `docs/DD.md`, `README.md`, `docs/architecture/invariants.md`: the new state, actions and commands.

## Testing

Engine tests per kind (apply, stale snapshot refused, disallowed target state refused, atomicity when one
target fails; merge step-down for every source state, all-legacy merge, mixed legacy refused); revision
tests (request blocks apply and admit, delivered once per session through prompt and session start,
`revises` closes the original); archive tests (no path archives without a reason); retrieval tests (legacy injected when uncovered, skipped when its replacement or topic peer
is in the pack, never outranking); MCP protocol test (`act` stores pending and cannot apply); UI server
tests (apply, reject, stale, review token required). `npm run eval` must stay at f1 ≥ 0.9, exact ≥ 90%.

## Out of scope

Waking an idle session from the UI (Claude Code channels, rejected 2026-09-24: research preview, one host
only); slash commands on OpenCode (skills reach it only through its own mechanisms, later); partial approval of a set action (reject and ask for a narrower one instead); actions that raise authority
or confidence; model-scheduled or delayed actions; cross-project actions.
