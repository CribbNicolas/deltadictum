---
title: Using DD well
description: What belongs in a memory, how to write one that fires when it should, checks, the review UI, a working rhythm, commands and troubleshooting.
nav_order: 3
---

# Using DD well

DD is only as good as its memories. This page is about writing ones that are worth delivering, making
them fire when they should, and keeping the store honest. The format itself is in [Memories](guide/memories.md).

## What belongs in a memory

> **One test.** Would a capable agent, reading the code, the tests and the docs, work this out on its own?
> If yes, do not save it: the agent will find it, and the memory costs context every time it fires. If no,
> save it, and say in one line why not. That line is the `not_derivable` field, and DD refuses a live
> memory without it.

| Save | Do not save |
|---|---|
| The test suite hangs when a store is left open; nothing in the code says so | "Close resources after use" |
| `legacy/` is kept for the importer and must not be refactored, although nothing references it | What `legacy/` contains (the agent can read it) |
| The hook must start with Node alone, so no dependency may be added, however small | "Keep dependencies minimal" |
| Deploys go through the `release/*` branch because CI signs from it; `main` is not deployable | How to run CI (the workflow file shows it) |
| We tried caching the index in memory and abandoned it: hooks are new processes every call | A design the code already implements |

Generic advice is rejected at ingestion (`generic_advice`). A memory that restates the code is accepted
but never earns its place: `deltadictum health` shows it idle and maintenance retires it.

## Choose the kind

| Kind | Use it for | Delivered as |
|---|---|---|
| `trap` | Something that breaks, and how to avoid it | `[TRAP]` |
| `decision` | A choice the project made, with the why, so the agent does not undo it | `[DECISION]` |
| `failed_approach` | Something tried and abandoned, so nobody tries it again | `[ABANDONED]` |
| `procedure` | Steps for a recurring task that nothing enforces | `[PROCEDURE]` |
| `fact` | A fact about the project or its environment the code does not show | `[FACT]` |

When in doubt between `trap` and `fact`: if ignoring it breaks something, it is a trap.

## Write the memory

The agent reads the title and the body at the moment it acts, with no time to think about them. Write for
that moment.

- **Title** (up to 200 characters): the instruction, as an imperative. "Close stores in t.after", not
  "Store handling in tests".
- **Body** (up to 1,500 characters): what to do, then why, naming the files, symbols, commands or values it
  is about. Concrete beats complete: one failure mode stated exactly is worth more than three described
  vaguely.
- **`not_derivable`** (one line, up to 300 characters): why reading would not reveal it. "Only a hung CI
  run shows it; no test or comment says so."
- **Topic**: `area/subject`, two to four lowercase segments (`testing/store-handle`,
  `deploy/release-branch`). One live memory per topic: a second one on the same topic is a revision, not
  a duplicate.
- **Evidence**: a repository file DD hashes (`{ "type": "file", "path": "tests/store.test.js" }`) whenever
  there is one. Verified evidence is what lets DD activate the memory without waiting for review, and it
  is how DD later notices the memory went stale.

A complete example, as the agent writes it into `.dd/inbox/`:

```json
{
  "topic": "testing/store-handle",
  "kind": "trap",
  "title": "Close stores in t.after",
  "body": "A test that opens a store must close it in t.after: a failing assertion otherwise leaves the handle open and node --test never ends. Pattern: const store = openStore(dir); t.after(() => store.close());",
  "not_derivable": "Only a hung CI run shows it; no test or comment says so.",
  "triggers": [{ "on": ["edit", "write"], "paths": ["tests/**/*.test.js"], "symbols": ["openStore"] }],
  "evidence": [{ "type": "file", "path": "tests/store.test.js", "summary": "The test that hung" }]
}
```

## Triggers that fire when they should

A trigger clause names the events it applies to (`on`: `prompt`, `read`, `edit`, `write`, `search`, `run`)
and at least one way to narrow them. A memory fires when any clause matches, once per session.

| Narrow by | Fires when | Use for |
|---|---|---|
| `paths` | The event touches a file matching the glob | Knowledge about particular files or folders (most memories) |
| `symbols` | The edited or written text contains the identifier | Knowledge about a function or class, wherever it is used |
| `commands` | The command the agent runs contains the word | Traps around `npm test`, `git push`, `docker`, a script |
| `keywords` | The prompt or the tool call contains the word or phrase | Decisions the user is likely to ask about ("why not Postgres") |
| `not`, `not_paths` | Cancels the clause | Excluding fixtures, generated files, one subfolder |

Guidance that holds up in practice:

- **Narrow paths.** `src/store/*.js` fires on the store; `src/**` fires on everything and makes the memory
  a hub that costs context in every session. The review UI's Hubs queue lists these.
- **Combine fields in one clause to narrow, use several clauses to widen.** `paths` and `symbols` in the
  same clause must both match; two clauses fire on either.
- **Name the event.** A trap about editing does not need to fire on reads. A procedure for a command
  belongs on `run` with `commands`, not on `paths`.
- **Prefer what the session touched.** When the agent saves after a fix and gives no triggers, DD
  suggests them from the files and commands of the session. These are usually right; check them in the
  review UI.
- **Check the dry run.** The review UI replays a memory's triggers over the last seven days of sessions
  and shows what would have fired. A memory that would have fired in every session is too broad; one that
  never would is probably dead.

Dead triggers (a glob that matches no file, a symbol absent from the code) keep a proposal from being
auto-accepted and are listed by `deltadictum health` and the Dead triggers queue.

## Checks: rules DD verifies itself

A memory can carry a check: a rule a changed file or a command must not break, as regular expressions.
DD evaluates it (never running code) and tells the agent only about violations the change introduced.

```json
"check": {
  "on": "edit",
  "paths": ["tests/**/*.test.js"],
  "if_content": "openStore\\(",
  "unless_content": "t\\.after\\(",
  "say": "This test opens a store without closing it in t.after.",
  "examples": {
    "violates": ["const s = openStore(dir);"],
    "passes": ["const s = openStore(dir);\nt.after(() => s.close());"]
  }
}
```

What the agent sees, at the end of the turn, for a file it changed:

```text
DD - check (Close stores in t.after): This test opens a store without closing it in t.after. (tests/a.test.js)
```

Rules for checks:

- `examples` are required and must behave as stated; a check whose examples fail is left out of the index.
- `when: turn` (the default for files) runs once at the end of the turn over the final state of the
  files; `when: edit` runs at each edit; command checks run at the command.
- A violation already in the last commit is not reported: checks speak about what the agent changed.
- A check is reported at most twice per file per session. A memory with a check is never auto-accepted;
  a person enables it in the review UI.

> **When to write one.** The rule is mechanical and the cost of missing it is real. Not for style: a
> linter does that better, and every check line costs the agent context.

## The review UI

`/dd:review` runs `deltadictum doctor`, shows its summary, and starts the UI. Open the printed address,
key included. The page updates itself as the store changes (a memory saved, a request from the agent, a
session recorded); the "live" mark beside the DD logo says it is connected. The views, in three groups:

| View | What it shows |
|---|---|
| **Dashboard** | The store by status, what waits for you, sessions, deliveries, coverage, the capture funnel, fires by trigger and by event, and the memories that fire most |
| **+ New memory** | A memory written by hand, validated as the agent's proposals are |
| **Candidates** | Proposals waiting for a person: accept, edit, or archive |
| **Agent requests** | What the agent asked: batches of proposals saved under one name (accept or reject the lot in one action), then requests to archive or revise a memory, with their reasons |
| **Accepted by DD** | Memories auto-accept activated; already firing. Mark each reviewed once you have read it |
| **Recent deliveries**, **All memories** | The last deliveries; the whole store |
| **Stale evidence** | The file a memory cites changed since it was hashed: re-verify or revise |
| **Hubs** | Memories whose triggers match much of the repository |
| **Dead triggers** | Globs or symbols that match nothing |
| **Suspected false alarms** | Checks that fired on a file the agent then left unchanged |
| **Duplicates** | Pairs of memories that say the same thing: merge |
| **Missing not_derivable** | Memories converted from v1 that still need their one line |

The dashboard's capture card shows the funnel: how often DD asked the agent for a memory, and how many proposals
were stored, activated or rejected, with the rejection reasons. A funnel with many asks and no proposals
means the agent is declining; with many rejections, read the reasons.

Each memory opens with its evidence (verified or stale), its breadth (how much of the repository its
triggers cover), its use (fires by the trigger dimension that matched), similar memories, and the dry run.
Every edit is validated as ingestion validates, and followed by a recompile.

Settings, the gear beside the DD logo: `auto_accept` and the delivery cap (`delivery_limit`, 2,000 to 50,000 characters per
delivery).

## A working rhythm

- **Let DD ask.** It asks only after a failure followed by a fix, or a correction from you, once per
  evidence set. Answering "save it" when the agent asks is cheaper than remembering later.
- **Ask for the rest.** `/dd:save` or "save this as a decision" for what you already know. The agent
  marks it `"origin": "user_explicit"`, so review knows it was yours.
- **Review weekly, lightly.** Candidates and Accepted by DD first. Most take a few seconds: the text is
  short and the evidence is one click away.
- **Archive, never delete.** Archiving keeps the file and the id; a restore is one action. Maintenance
  archives what never fires, and a memory a person reviewed is exempt from that.
- **Revise rather than pile up.** A new proposal on a topic with a live memory is a revision
  (`replaces`); accepting it supersedes the old one in the same commit. The store stays one memory per topic.

## Working as a team

- Memories are JSON files under `.dd/memories/`, so they merge, diff and review like code. A pull request
  that adds a memory can be read in full by the reviewer.
- Two people saving on one topic yields two files; the review UI's Duplicates queue shows them to merge.
- `.dd/local/` is per machine. Counters, deliveries and health are each person's view; the memories are
  shared.
- Set `{ "auto_accept": false }` in `.dd/config.json` if the team prefers every memory to pass a person
  before it fires.

## Commands

| In the session | Does |
|---|---|
| `/dd:save` | Saves knowledge from the conversation as a memory (or asks for a change to one) |
| `/dd:recall <topic>` | Shows what DD knows on a topic |
| `/dd:review` | Runs doctor, then opens the review UI and prints its address |

| Terminal (`npx deltadictum …`) | Does |
|---|---|
| `init [--project-id NAME]` | Opts the project in and compiles |
| `doctor` | Is DD working here: Node, the opt-in, the index, sessions recorded, maintenance, what needs a person; exit 1 on a problem |
| `status` | Memory counts by status, and topics with more than one live memory |
| `health` | Each memory's health: dead triggers, idle, hubs, stale evidence, false alarms; the capture funnel |
| `recall QUERY [--all] [--limit N]` | Prints the memories that match, in full (`--all` includes candidates) |
| `ui [--port N]` | The review UI, until interrupted (default port 7733; a busy port falls back to a free one) |
| `compile` | Rebuilds the index by hand (session start does it when the memories changed) |
| `maintain` | The daily maintenance, by hand |
| `import [--from DIR] [--dry-run]` | Turns `.claude/rules/` and `.cursor/rules/` files that name paths into memories |
| `migrate [--dry-run]` | Converts a DD 0.8 store |
| `install --host codex --project PATH [--dry-run]` | Writes DD's Codex configuration into a project |

## Troubleshooting

| Symptom | Look at |
|---|---|
| Nothing is ever delivered | `npx deltadictum doctor`. Is the project opted in (`.dd/config.json`)? Is the index compiled? Is Node 22.16 or later on the `PATH` the agent uses? |
| A memory did not fire on a file it covers | Open it in the review UI and run the dry run. Check the event kind in `on` (a read is not an edit) and that the glob matches the path as the repository spells it. Remember: once per session; `/clear` re-arms it |
| DD never asks the agent to save | It asks only after a failure followed by a fix, or a correction, in a project that opted in. `health` shows the capture funnel: asks against proposals |
| A proposal keeps being rejected | The reply names the reasons: `generic_advice`, a missing `not_derivable`, a secret-shaped string, an unsafe glob, a size over the limit. The file is kept in `.dd/inbox/` for the agent to fix |
| Stored as a candidate, not active | The reply names the condition: `no_verified_evidence`, `triggers_unverified`, `dead_trigger`, `has_check`, `suspected_duplicate`, `revision`, or `auto_accept_disabled`. Accept it in the review UI |
| The review UI answers 403 | Open the exact URL it printed, with `?key=`; the key becomes a cookie. It also refuses any `Host` but its own |
| A hook is slow | The hot path is one Node start per tool call, a few tens of milliseconds. A very large index or a repository with hundreds of thousands of files shows up here; `health` lists hubs |
| Everything went quiet after an upgrade | `/plugin` to confirm the version; start a new session; `doctor` |

A hook that fails ends silently by design: DD never blocks the host. Doctor is where failures become
visible.
