---
title: Home
nav_order: 1
permalink: /
---

<p align="center"><img src="assets/DeltaDictum-mark.svg" width="88" alt="DeltaDictum mark"></p>

# DeltaDictum

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

## What the agent sees

Nothing at session start. When the agent is about to edit a file a memory covers, the hook adds the memory
to that tool call:

```text
DD - project knowledge (tests/store.test.js):
[TRAP] Close stores in t.after - A test that opens a store must close it in t.after: a failing
assertion otherwise leaves the handle open and node --test never ends.
```

The memory arrives once per session, only at the action it applies to. A session that never touches
`tests/` never pays for it.

## Quickstart (Claude Code)

You need [Node.js](https://nodejs.org) 22.16 or later.

1. Install the plugin:

   ```text
   /plugin marketplace add CribbNicolas/deltadictum
   /plugin install dd@deltadictum
   ```

2. Opt the project in, from its root:

   ```bash
   npx deltadictum init
   ```

   This writes `.dd/config.json`, `.dd/.gitignore` and `.dd/memories/`. Commit them.

3. Work as usual. When a fix teaches the agent something the code does not show, DD asks it to save a
   memory at the end of the turn. You can also ask: `/dd:save`, or "save this as a trap".
4. Review what was saved with `/dd:review`.

The whole walk-through, with what you will see at each step: [Getting started](getting-started.md).

## Measured

On this repository's 15 agent tasks (Claude Code with Claude Sonnet 5.5, 30 runs with DD against 15
without, code quality scored by a blind Claude Opus judge):

| | Agent alone | With DD |
|---|---|---|
| Tasks resolved | 93% | 93% |
| Code quality | 70% | 77% |
| The project's own requirements met | 78% | 100% |
| Context | 27.2k tokens | 27.2k tokens |
| Cost per task | $0.090 | $0.090 |

One project, one model, a small sample: these numbers say DD is on track, not that it will do the same on
yours. [How it is measured](guide/how-it-works.md#how-it-is-measured), and the
[second trial](benchmarks/2026-10-v2-trial-opus-haiku.md) with Claude Opus 5.5 and Claude Haiku 5.5.

## Where next

- [Getting started](getting-started.md): install, opt in, first memory, review, share with the team.
- [Using DD well](using-dd.md): what to save, how to write a memory that fires when it should, checks, the
  review UI, troubleshooting.
- [Reference](guide/index.md): how DD works, the memory format, configuration, storage, the security boundary.
- [Harnesses](integrations/index.md): Codex, OpenCode and Grok Build.
- [Architecture](architecture/index.md): the behavioural contract, the plugin constraints, the invariants.
