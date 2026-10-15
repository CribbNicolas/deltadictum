# DeltaDictum current contract

DD v2 keeps project knowledge an agent cannot derive from the code, and delivers each piece at the action it
applies to. The design is [the v2 spec](superpowers/specs/2026-10-08-dd-v2-design.md); this page states what
the code does today. Where this document and `src/` disagree, `src/` is what DD does and this document is
corrected.

## Memories

- A memory is one JSON file, `.dd/memories/<id>.json` (schema 8, `src/memory/schema.js`), committed with the
  project. Its kind is `decision`, `trap`, `failed_approach`, `fact` or `procedure`; its status is `candidate`,
  `active`, `contested`, `superseded` or `archived`.
- A memory carries a title, a body, `not_derivable` (why a capable agent reading the code would not work it
  out), triggers, an optional check, evidence and its origin (`model_initiated` or `user_explicit`).
  `not_derivable` is required for a memory to be live, except for memories converted from v1
  (`review.migrated`) until a person supplies it in the review UI.
- At most one live (`active` or `contested`) memory per topic. A revision is a candidate that `replaces` a live
  memory; accepting it supersedes that memory in the same commit.
- Writes go through one journaled, locked transaction (`src/store/transactions.js`); an interrupted one is
  rolled forward before the next. Validation (schema, secrets, unsafe content, glob safety, sizes) runs before
  anything is written.
- `.dd/local/` is derived and git-ignored: the compiled index, session files, telemetry. `deltadictum
  compile` rebuilds the index; session start rebuilds a stale one.

## Delivery

- A memory fires when one of its trigger clauses matches an event: `on` names the event kinds (`prompt`,
  `read`, `edit`, `write`, `run`, `search`), and paths (globs with `*`, `**`, `?` and `{a,b}`), symbols,
  commands or prompt keywords narrow it. Matching is rule matching over the compiled index
  (`src/engine/match.cjs`), not similarity search.
- Delivery happens in the harness's hooks: at the prompt and before each tool call. Session start injects
  nothing. There is no MCP server. A shell command that only reads or searches (`cat`, `head`, `sed -n`,
  `rg`, `ls`…) is a read or search event, in Claude Code as in Codex; one that may change something (a
  redirection, an in-place `sed`, any other program) is a run (`src/hooks/v2/events.cjs`).
- Each memory is delivered at most once per epoch of a session, and once per subagent (`src/engine/ledger.cjs`);
  a compaction or `/clear` starts a new epoch. The ledger's claim records the dimension that fired the
  memory (or `check`), the event kind and the time. A delivery is at most 10,000 characters: what does not
  fit whole is named and arrives at its next event. Stale evidence and disputed memories are marked.
- Delivered text is advisory project knowledge. It never outranks the host, the user or the current code.

## Checks

- A memory may carry a declarative check: a regular expression over a changed file (`if_content`,
  `unless_content`) or over a command (`if_command`, `unless_command`). A check never executes code.
- Its `violates` and `passes` examples must behave as stated, or the compiler leaves it out. Unsafe patterns are
  refused, and evaluation runs under a time limit.
- `when: turn` (the default for files) runs at Stop over the final state of the files the turn changed;
  `when: edit` runs at the edit; command checks run at the command. Only a violation the change introduced is
  reported: one already in the last commit (turn checks) or in the file before the call (edit checks) is not.
  A violation is reported at most twice per file per epoch, and a check that fired on a file the agent then
  left unchanged is recorded as a suspected false alarm.

## Capture

- A project opts in with its `.dd/` folder: a committed `.dd/config.json`, or its first memory. Without
  it, hooks record nothing and ask nothing (`src/hooks/v2/hook.cjs`).
- Hooks record a footprint per session: paths, redacted commands, search patterns, identifiers and outcomes.
  Prompt text is not kept, except a short preview of a prompt detected as a user correction.
- At Stop, DD asks the agent for a memory only when the turn holds evidence (a failure followed by a fix, or a
  correction), once per evidence set.
- The agent saves knowledge by writing `.dd/inbox/<name>.json` (the `save` skill). DD ingests it in the same
  turn: it validates the proposal, suggests triggers from the session when none are given, refuses generic
  advice, and answers with the result. A proposal becomes a candidate, or an active memory when auto-accept
  applies. A proposal on a topic whose candidate is still pending replaces it; the replaced candidate is
  archived, never deleted. Every ingestion leaves one telemetry line with its outcome and reasons
  (`.dd/local/telemetry/inbox.jsonl`), never the content.
- Auto-accept (on by default; `.dd/config.json` `"auto_accept": false` turns it off) activates a candidate only
  when DD verified its grounds itself (a repository file it hashed, or a correction it recorded that names the memory and follows something the agent did), every trigger is
  live, it has no check, and it neither duplicates nor revises a live memory. A reported success never counts.
- The agent's requests to archive or revise a memory wait for a person in the review UI.

## Maintenance and review

- Maintenance runs detached from session start at most once a day (`deltadictum maintain` by hand): session
  files are rolled up into `.dd/local/telemetry.sqlite` and pruned after seven days, unused memories are
  retired, and the similarity index is refreshed.
- An active memory whose paths were touched in at least 20 sessions (`retire.after_sessions`) without it firing
  is archived. A memory a person reviewed is never retired this way, nor one a pending candidate revises.
  Archiving keeps the file.
- `deltadictum health` reports dead triggers, memories with no opportunity or none used despite it, hubs,
  triggers only on central paths, suspected false alarms and stale evidence; for each memory, its fires by
  the dimension that matched; the capture funnel (asks, corrections, proposals stored, activated or rejected,
  rejections by reason) and the last deliveries. `recall` and `status` read the store.
- `deltadictum ui` serves the review UI for one project on a loopback port, until interrupted: queues
  (among them the memories DD accepted on its own, until a person marks each as reviewed), a memory with its
  breadth, evidence, use and similar memories, a dry run of its triggers over recorded sessions, and every
  edit and status change, each validated as ingestion validates and followed by a recompile. It answers only
  its own Host, only a browser holding its key, and takes changes only as JSON.

## Harnesses

- Claude Code is supported in full. Codex receives the same delivery through its hooks: its shell tool is
  classified as Claude Code's Bash is, `apply_patch` headers name the edited files, and Stop answers with
  a block. OpenCode receives memories appended to the tool result, leaving the system prompt and its cache
  alone. Grok Build runs the same hooks with Claude Code's payload shape, not yet checked against a recorded
  session.
- A hook that fails ends silently: DD never blocks the host.

## Migration

- `deltadictum migrate [--dry-run]` converts a v1 store (`.dd/atoms/` and the rest) into v2 memories, keeping
  their ids, and queues every converted memory for a person to supply `not_derivable`.

**DD is a plugin for coding-agent harnesses, not a service.**
[`architecture/plugin-constraints.md`](architecture/plugin-constraints.md) states the limits that follow.
