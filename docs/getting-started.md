---
title: Getting started
description: Install DeltaDictum in Claude Code, Codex, OpenCode or Grok Build, opt a project in, save a first memory, see it fire, review it and share it with the team.
nav_order: 2
---

# Getting started

Twenty minutes from nothing to a memory the agent receives at the right moment. Every step says what you
will see, so you know it worked. The steps follow the harness chosen in the menu; the tabs above a block
change it too.

## 1. Requirements

- [Node.js](https://nodejs.org) 22.16 or later on the machine's `PATH` (Windows, Linux or macOS).
- A git repository. Memories are files you commit; DD does nothing with them outside a repository.
- One of the harnesses DD runs in. Claude Code is supported in full and is where DD is measured; the others
  are added one at a time, each verified against a recorded session before it is called supported.

The memory store is the same for every harness: a project's `.dd/memories/` serves them all.

## 2. Install the plugin

<!-- for: claude-code -->

In Claude Code:

```text
/plugin marketplace add CribbNicolas/deltadictum
/plugin install dd@deltadictum
```

Start a new session. `/dd:save`, `/dd:recall` and `/dd:review` are now available, and DD's hooks run on
every tool call. Update later from `/plugin`.

<!-- /for -->

<!-- for: codex -->

> **Status:** the adapter is unit-tested against Codex payloads recorded in 2026-09 (codex-cli 0.154); it
> is not yet verified in a live session.

Codex has no plugin marketplace, so DD writes the project's Codex configuration. Install DD globally
first, so the configuration points at a directory that stays (an `npx` cache can be cleared):

```bash
npm install -g deltadictum
deltadictum install --host codex --project "<absolute-project-path>" --dry-run   # what it would write
deltadictum install --host codex --project "<absolute-project-path>"
```

It writes, keeping everything else in each file:

- `.codex/hooks.json`: DD's hooks (session start, prompt, every tool call before and after, proposals
  made through `apply_patch`, and Stop), each running `hooks/run.cjs <command> --codex`;
- `.codex/config.toml`: a managed block saying DD runs no MCP server;
- `AGENTS.md`: a short managed block telling the agent what DD's deliveries are and how to save knowledge;
- `.agents/skills/dd-save`, `dd-recall`, `dd-review`: the commands, as Codex skills.

Then open the project in Codex, trust it, and trust DD's hooks in `/hooks`: Codex ignores a project's
`.codex/` configuration until both are trusted. After `npm update -g deltadictum`, run the install
command again; it refreshes DD's own handlers and keeps yours.

<!-- /for -->

<!-- for: opencode -->

> **Status:** the adapter is unit-tested against OpenCode's plugin API; it is not yet verified in a live
> session.

Add DD to the project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["deltadictum"]
}
```

OpenCode runs plugins in Bun, which has no `node:sqlite`, so the adapter imports nothing from DD: it runs
DD's hooks in Node, which must be 22.16 or later on the `PATH`. OpenCode has no DD commands; ask the agent
in words, and use `npx deltadictum` in a terminal for the rest.

<!-- /for -->

<!-- for: grok -->

> **Status:** not verified. The plugin runs the hooks Claude Code runs, assuming Claude Code's payload
> shape; Grok's real payloads have not been recorded yet, so a tool name Grok spells differently fires
> nothing.

```bash
grok plugin marketplace add CribbNicolas/deltadictum
grok plugin install deltadictum@deltadictum --trust
```

`--trust` is required for the hooks to load. The plugin's `save`, `recall` and `review` skills come with
it.

<!-- /for -->

**What you will see:** nothing yet. A project without a `.dd/` folder is left alone.

## 3. Opt the project in

From the project's root:

```bash
npx deltadictum init
```

It writes three things, all meant to be committed:

| Path | Holds |
|---|---|
| `.dd/config.json` | The project id and settings; its presence is the opt-in |
| `.dd/.gitignore` | Keeps DD's derived files (`.dd/local/`, `.dd/inbox/`) out of git |
| `.dd/memories/` | The memories, one JSON file each |

```bash
git add .dd && git commit -m "Opt the project into DeltaDictum"
```

> **Tip:** a `.dd/config.json` holding `{}` written by hand works too, as does a first memory the agent
> saves. The folder is the opt-in; DD never creates it on its own.

<!-- for: claude-code -->

**What you will see:** from the next session on, one line when the session starts:

```text
DD - on for this project, no memories yet. Save one with /dd:save; review with /dd:review.
```

Once there are memories, the line counts them and points at the review UI. It is shown to you only; the
agent's context gets nothing at session start.

<!-- /for -->

<!-- for: codex opencode grok -->

**What you will see:** nothing at session start; the agent's context gets nothing then either. The check
below is how you know DD is on.

<!-- /for -->

**Check:** `npx deltadictum doctor` prints a `summary` line. In a fresh project it says DD is working and
that there are no memories yet.

## 4. Save the first memory

Pick something you already know the code does not show. The best candidates are the things you keep
telling the agent:

- "Run the suite with `--test-concurrency=1`; the stores share a port."
- "Never add a dependency to `package.json`; the hook must start with Node alone."
- "The `legacy/` folder is kept for the importer; do not refactor it."

Tell the agent, in the session, in plain words:

```text
Save this as a trap: tests that open a store must close it in t.after, or node --test hangs.
It only shows as a hung CI run. The file is tests/store.test.js.
```

The agent writes a proposal into `.dd/inbox/` and DD answers in the same turn, through the agent:

```text
DD - testing/store-handle: stored and active (DD verified its evidence), id 6f1c….
```

Or, when a condition for auto-accept was not met:

```text
DD - testing/store-handle: stored as a candidate for review (no_verified_evidence), id 6f1c….
```

Or a rejection with its reasons, which the agent fixes and resubmits.

> **Rejected?** A proposal that reads like generic advice ("write tests"), or one that lacks the line
> saying why the code does not show it, is refused. [Using DD well](using-dd.md#what-belongs-in-a-memory)
> has the test to apply before saving.

**What was written:** `.dd/memories/<id>.json`. Open it; it is readable. Commit it.

## 5. See it fire

In a new session, ask the agent to touch what the memory covers:

```text
Add a test for the store's close() method in tests/store.test.js.
```

Before the edit, the hook adds the memory to that tool call. The agent's context shows:

```text
DD - project knowledge (tests/store.test.js):
[TRAP] Close stores in t.after - A test that opens a store must close it in t.after: …
```

The agent does not announce it; it acts on it. To see what DD knows explicitly, run
`npx deltadictum recall store` from a terminal, or in the session:

```text for=claude-code
/dd:recall store
```

```text for=codex
Use the dd-recall skill: what does DD know about the store?
```

```text for=grok
Use the deltadictum recall skill: what does DD know about the store?
```

<!-- for: opencode -->

On OpenCode a memory arrives with the result of the tool call it applies to, not before the call: a read
is unaffected, and an edit learns of its trap one step late. The system prompt is left alone, so the
prompt cache holds.

<!-- /for -->

A memory is delivered once per session (again after a compaction or `/clear`). If it did not fire, see
[Troubleshooting](using-dd.md#troubleshooting).

## 6. Let DD capture on its own

From now on DD records what each session touches: paths, redacted commands, how commands ended, your
corrections. Prompt text is not kept. At the end of a turn that held a failure followed by a fix, or a
correction from you, DD asks the agent:

```text
DD - This turn fixed a failing command. If it taught something an agent reading the code, tests and
docs would not work out, save it; otherwise do nothing.
```

The agent decides. What it saves goes through the same validation as step 4. A memory DD activated on its
own waits in the review UI's "Accepted by DD" queue until you mark it reviewed, so nothing enters the
store unseen.

To review every proposal yourself before it fires, set `{ "auto_accept": false }` in `.dd/config.json`.

<!-- for: opencode -->

OpenCode has no Stop hook, so DD does not ask at the end of a turn, and the checks that run once at the
end of a turn do not run. The agent still saves knowledge when you ask for it.

<!-- /for -->

## 7. Review

```text for=claude-code
/dd:review
```

```text for=codex
Use the dd-review skill.
```

```text for=grok
Use the deltadictum review skill.
```

```bash for=opencode
npx deltadictum doctor
npx deltadictum ui
```

The agent runs `deltadictum doctor`, tells you its summary, and starts the review UI in the background
(on OpenCode you run both yourself). It prints an address like:

```text
DD - review UI: http://127.0.0.1:7733/?key=3f9a…
```

> **Open that exact URL.** The key is what lets your browser in; without it the UI answers 403.

The UI lists candidates, memories DD accepted on
its own, stale or unused memories, duplicates, the agent's requests and the last deliveries. For each
memory it shows the evidence, how broad its triggers are, how often it fired and by which trigger, and it
dry-runs the triggers over recent sessions so you can see what would have fired. Edit, accept, archive,
merge or restore from there. [Using DD well](using-dd.md#the-review-ui) walks through it.

Stop the UI with Ctrl+C in its terminal, or leave it; it serves one project on a loopback address only.

## 8. Share with the team

Memories are files under `.dd/memories/`. Commit and push them like code; a teammate who pulls and has the
plugin installed receives the same deliveries. `.dd/local/` (the index, session files, counters) never
leaves the machine and is rebuilt from the memories.

Two people saving on the same topic produce two files, not a conflict; DD keeps at most one live memory
per topic and shows the other as a duplicate to merge in the review UI.

## 9. Keep it healthy

- `npx deltadictum doctor` whenever something seems off. A hook that fails never says so (it must not block
  the agent); doctor does.
- Maintenance runs on its own once a day, detached from session start: it rolls session files up, prunes
  them after seven days, and retires memories whose files keep being touched without them ever firing
  (20 sessions by default). A memory a person reviewed is never retired this way.
- `npx deltadictum health` lists dead triggers (a glob with no file, a symbol absent from the code), idle
  memories, stale evidence and suspected false alarms.

## Coming from `CLAUDE.md` or `.claude/rules/`

Keep `CLAUDE.md` for what every session needs. Move what applies to specific files into memories, which
cost nothing in the sessions that never touch those files:

```bash
npx deltadictum import --dry-run   # what would be converted
npx deltadictum import
```

It turns the `.claude/rules/*.md` and `.cursor/rules/*.mdc` files that name paths into memories, with the
file as evidence. A rule with no paths belongs in `CLAUDE.md` and is left alone.

