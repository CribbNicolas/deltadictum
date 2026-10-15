<p align="center"><img src="brand/DeltaDictum-mark.svg" width="88" alt="DeltaDictum mark"></p>

# DeltaDictum

[![CI](https://github.com/CribbNicolas/deltadictum/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/CribbNicolas/deltadictum/actions/workflows/publish.yml)
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

## What it measured

On this repository's 15 agent tasks (Claude Code, Claude Sonnet 5.5, 30 runs with DD against 15 without,
same day, code quality scored by a blind Claude Opus judge):

| | Agent alone | With DD |
|---|---|---|
| Tasks resolved | 93% | 93% |
| Code quality | 70% | 77% |
| The project's own requirements met | 78% | 100% |
| Context | 27.2k tokens | 27.2k tokens |
| Cost per task | $0.090 | $0.090 |

The earlier version of DD, which searched its memories by similarity, reached similar quality at 46% more
cost. These numbers come from one project, one model and a small sample; they say DD is on track, not that
it will do the same on yours. A second trial with Claude Opus 5.5 and Claude Haiku 5.5 at high effort
found no quality difference between any condition (both models reached every rule by reading the code)
and DD again the cheapest condition for both
([details](docs/benchmarks/2026-10-v2-trial-opus-haiku.md)). More:
[how it is measured](docs/guide/how-it-works.md#how-it-is-measured).

## Quickstart (Claude Code)

You need [Node.js](https://nodejs.org) 22.16 or later.

1. Install the plugin from Claude Code:

   ```text
   /plugin marketplace add CribbNicolas/deltadictum
   /plugin install dd@deltadictum
   ```

2. Opt the project in: commit a `.dd/config.json` (`{}` is enough), or save a first memory with
   `/dd:save`. A project without a `.dd/` folder is left alone.
3. Work as usual. When a fix teaches the agent something the code does not show, DD asks it, at the end of
   the turn, to save a memory; you can also ask for one (`/dd:save`, or "save this as a trap").
4. Review what was saved with `/dd:review`, which opens the local review UI.

From then on, a memory reaches the agent when it touches what the memory covers.

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

## How it works

1. **Triggers, not search.** Each memory names the events it applies to: a prompt mentioning some words, a
   read or edit of certain files, a command, a symbol. DD compiles them into an index and matches every
   tool call against it. A memory that does not match is never sent.
2. **Delivery at the action.** Hooks add the memories that match to the prompt or the tool call, once per
   session (again after a compaction). Session start adds nothing.
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

```text
/plugin marketplace add CribbNicolas/deltadictum
/plugin install dd@deltadictum
```

The `/dd:save`, `/dd:recall` and `/dd:review` commands become available in new sessions. Update the plugin
from `/plugin`.

### Codex (not yet verified live)

Codex has no plugin marketplace, so DD writes the project's Codex configuration:

```bash
npm install -g deltadictum
deltadictum install --host codex --project "<absolute-project-path>"
```

Then open the project in Codex, trust it, and trust DD's hooks in `/hooks`. Details:
[Codex guide](docs/integrations/codex.md).

### OpenCode and Grok Build

See the [OpenCode guide](docs/integrations/opencode.md) and the [Grok Build guide](docs/integrations/grok-build.md).

### Upgrading from DD 0.8 or earlier

DD v2 replaces the memory format. Convert a project's store once, then commit the result:

```bash
npx deltadictum migrate --dry-run   # what would change
npx deltadictum migrate
```

Every converted memory keeps its id and waits in the review UI for one line saying why the code does not
show it. Details: [CHANGELOG](CHANGELOG.md).

## Using DD

| Command | Does |
|---|---|
| `/dd:save` | Saves knowledge from the conversation as a memory |
| `/dd:recall <topic>` | Shows what DD knows on a topic |
| `/dd:review` | Opens the review UI |

The review UI (`npx deltadictum ui`) lists candidates, memories DD accepted on its own, stale or unused
memories, duplicates, the agent's requests and the last deliveries; shows each memory's evidence, breadth
and use (by the trigger dimension that fired it); dry-runs a memory's triggers over recent sessions; and
edits, accepts, archives, merges or restores. Its header shows the capture funnel: how often DD asked for
a memory, and how many proposals were stored, activated or rejected. On the command line: `deltadictum
recall`, `status`, `health` and `maintain`.

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

- [How DD works](docs/guide/how-it-works.md): triggers, delivery, capture, checks, maintenance, measurements
- [Memories](docs/guide/memories.md): kinds, fields, triggers, statuses
- [Configuration](docs/guide/configuration.md) and [storage](docs/guide/storage.md)
- [Security boundary](docs/guide/security.md)
- Harness guides: [Codex](docs/integrations/codex.md), [OpenCode](docs/integrations/opencode.md),
  [Grok Build](docs/integrations/grok-build.md)
- [Behavioural contract](docs/DD.md), [plugin constraints](docs/architecture/plugin-constraints.md) and
  [where DD came from](docs/architecture/history.md)
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
