<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/DeltaDictum-mark-light.svg">
    <img src="brand/DeltaDictum-mark.svg" width="88" alt="DeltaDictum mark">
  </picture>
</p>

# DeltaDictum

[![CI](https://github.com/CribbNicolas/deltadictum/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/CribbNicolas/deltadictum/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/deltadictum)](https://www.npmjs.com/package/deltadictum)
[![node](https://img.shields.io/node/v/deltadictum)](package.json)
[![license](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](LICENSE)

DeltaDictum (DD) gives a coding agent the engineering knowledge your code does not show, right before it
acts:

- the decisions behind the code;
- the traps someone already fell into;
- the steps nothing enforces.

Each memory says when it applies (its triggers), what to do, and why the code alone would not tell the
agent. DD delivers it when the agent reads, edits or runs something the memory covers, once per session,
and stays silent otherwise.

DD is a **plugin**, not a service. Memories are JSON files in your repository, shared through git;
everything else stays on your machine. No account, no model calls, no background process, no dependencies.

The benchmark, with its caveats, is on the [site](https://cribbnicolas.github.io/deltadictum/#measured-title).

## Quickstart (Claude Code)

You need [Node.js](https://nodejs.org) 22.16 or later.

1. Install the plugin from Claude Code:

   ```text
   /plugin marketplace add CribbNicolas/deltadictum
   /plugin install dd@deltadictum
   ```

2. Opt the project in: `npx deltadictum init` writes `.dd/config.json`, `.dd/.gitignore` and
   `.dd/memories/` for you to commit (a `.dd/config.json` holding `{}` written by hand is enough too, as
   is a first memory saved with `/dd:save`). A project without a `.dd/` folder is left alone.
3. Work as usual. When a fix teaches the agent something the code does not show, DD asks it, at the end of
   the turn, to save a memory; you can also ask for one (`/dd:save`, or "save this as a trap").
4. Review what was saved with `/dd:review`, which opens the local review UI.

From then on, a memory reaches the agent when it touches what the memory covers. The full walk-through,
with what you see at each step: [Getting started](https://cribbnicolas.github.io/deltadictum/getting-started).

## Next to what Claude Code already has

Claude Code loads `CLAUDE.md` every session, loads a `.claude/rules/` file when the agent reads a file its
`paths` name, and keeps auto memory, the notes it writes itself from your corrections, per user and
repository. DD is for what those leave out:

- knowledge shared with the team through git, not notes on one machine;
- delivered at the action, once per session, instead of at every session start: a memory about one file
  costs nothing in the sessions that never touch it, and a prompt, a command or a symbol can trigger it too;
- captured with evidence DD verified (a file it hashed, a correction it recorded) and kept in review
  queues, instead of free-form notes;
- rules DD checks itself, retirement of what never fires, and one store for the other harnesses as they
  are verified.

`npx deltadictum import` turns the `.claude/rules/` and `.cursor/rules/` files that name paths into
memories (the file stays the evidence; a rule with no paths belongs in `CLAUDE.md` and is left alone).

## How it works

1. **Triggers, not search.** Each memory names the events it applies to: a prompt mentioning some words, a
   read or edit of certain files, a command, a symbol. DD compiles them into an index and matches every
   tool call against it. A memory that does not match is never sent.
2. **Delivery at the action.** Hooks add the memories that match to the prompt or the tool call, once per
   session (again after a compaction). Session start adds nothing to the agent's context: it shows you one
   line with the number of live memories and how to open the review UI.
3. **Capture with evidence.** DD records what the agent touched and how commands ended. After a failure
   followed by a fix, or a correction from you, it asks the agent to save what it learned. The agent writes
   a proposal; DD validates it, rejects generic advice, and stores it.
4. **Review.** A proposal backed by evidence DD verified itself (a file it hashed, a correction it
   recorded) becomes active at once; that is the default, and [configurable](#configuration). The rest wait
   for you in the review UI.
5. **Checks.** A memory can carry a rule (a pattern a changed file or a command must not match). DD reports
   only violations the change introduced, and never runs code.
6. **Maintenance.** Once a day DD rolls up what it recorded and retires memories that never fire although
   their files keep being touched.

More in [How DD works](docs/guide/how-it-works.md).

## Compatibility

| Harness | Status |
|---|---|
| Claude Code | Supported and measured |
| Codex | Adapter written and unit-tested against recorded payloads; not yet verified in a live session |
| OpenCode | Adapter written (memories arrive with the tool result); not yet verified in a live session |
| Grok Build | Registers Claude Code's hooks; its payload shapes are not yet verified |

Support for other harnesses is added one at a time, after Claude Code. **Requirements:** Node.js 22.16 or
later on Windows, Linux or macOS (macOS passes CI but has not been used in a real session).

## Install

### Claude Code

The two commands in the [Quickstart](#quickstart-claude-code). The `/dd:save`, `/dd:recall` and
`/dd:review` commands become available in new sessions. Update the plugin from `/plugin`.

### Codex (not yet verified live)

Codex has no plugin marketplace, so DD writes the project's Codex configuration:

```bash
npm install -g deltadictum
deltadictum install --host codex --project "<absolute-project-path>"
```

Then open the project in Codex, trust it, and trust DD's hooks in `/hooks`. The install writes the
project's opt-in (`.dd/config.json`) when there is none.

### OpenCode and Grok Build

Their install steps, and what each one does not get yet, are in
[Getting started](https://cribbnicolas.github.io/deltadictum/getting-started), with the harness chosen in the menu.

## Using DD

| Command | Does |
|---|---|
| `/dd:save` | Saves knowledge from the conversation as a memory |
| `/dd:recall <topic>` | Shows what DD knows on a topic |
| `/dd:review` | Opens the review UI |

The review UI (`npx deltadictum ui`):

- lists candidates, memories DD accepted on its own, stale or unused memories, duplicates, the agent's
  requests and the last deliveries;
- shows each memory's evidence, breadth and use (by the trigger dimension that fired it), and dry-runs its
  triggers over recent sessions;
- edits, accepts, archives, merges or restores, and shows the capture funnel: how often DD asked for a
  memory, and how many proposals were stored, activated or rejected.

On the command line: `deltadictum recall`, `status`, `health` and `maintain`; `deltadictum doctor` says
whether DD is working in the project (Node, the opt-in, the index, sessions recorded, maintenance, what
needs a person), since a hook that fails never says so. How to write memories that earn their place, and
what to do when one does not fire: [Using DD well](https://cribbnicolas.github.io/deltadictum/using-dd).

## Memory types

| Kind | For |
|---|---|
| `trap` | Something that breaks, and how to avoid it |
| `decision` | A project choice, with why |
| `failed_approach` | Something tried and abandoned, so nobody tries it again |
| `procedure` | Steps to follow for a recurring task |
| `fact` | A fact about the project or its environment that the code does not show |

Fields, statuses and triggers: [Memories](docs/guide/memories.md).

## Configuration

Project settings live in `.dd/config.json`, committed with the project. The file's presence (or a first
memory) is what turns DD on for the project; every key is optional.

| Setting | Default | What it does |
|---|---|---|
| `auto_accept` | on | Activate a proposal backed by evidence DD verified; `false` sends every proposal to review |
| `retire.after_sessions` | `20` | Sessions touching a memory's files without it firing before it is retired |

Every setting and environment variable: [Configuration](docs/guide/configuration.md).

## Documentation

The site, [cribbnicolas.github.io/deltadictum](https://cribbnicolas.github.io/deltadictum/), has the same
pages with navigation and search. In the repository:

- [Getting started](https://cribbnicolas.github.io/deltadictum/getting-started) and [Using DD well](https://cribbnicolas.github.io/deltadictum/using-dd)
- [How DD works](docs/guide/how-it-works.md): the loop, delivery in each harness, capture, checks, maintenance
- [Commands](docs/commands.md): in the session, by harness, and the command line
- [Memories](docs/guide/memories.md): kinds, fields, triggers, statuses
- [Configuration](docs/guide/configuration.md) and [storage](docs/guide/storage.md)
- [Security boundary](docs/guide/security.md)
- [Behavioural contract](docs/DD.md)
- [Changelog](CHANGELOG.md) and [contributing](CONTRIBUTING.md)

## Security

The review UI listens on a loopback address only, answers only a browser holding the key it prints, and
accepts changes only as JSON. Proposals carrying credentials or unsafe content are refused. Details:
[Security boundary](docs/guide/security.md). Report vulnerabilities privately as described in
[SECURITY.md](SECURITY.md).

## License

DD is source-available under the [PolyForm Shield License 1.0.0](LICENSE), not an open-source license.
You may install and use it for any purpose, including in paid work and inside a company, and you may
change it and share copies with the license attached. You may not sell it, offer it as a hosted or
managed service, or use it to provide any product that competes with DD. For other terms, contact the
author through the [repository](https://github.com/CribbNicolas/deltadictum).
