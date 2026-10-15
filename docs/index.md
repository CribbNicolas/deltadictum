---
title: Home
description: DeltaDictum gives coding agents the engineering knowledge the code does not show, at the action it applies to. A local plugin for Claude Code, shared through git.
nav_order: 1
permalink: /
---

<div class="dd-hero">
  <img src="{{ '/assets/DeltaDictum-mark-light.svg' | relative_url }}" alt="DeltaDictum mark" width="96" height="96">
  <h1>DeltaDictum</h1>
  <p class="dd-tagline">The engineering knowledge your code does not show, delivered to the coding agent at the action it applies to.</p>
  <p>
    <a class="btn btn-primary" href="{{ '/getting-started' | relative_url }}">Get started</a>
    <a class="btn" href="{{ '/guide/how-it-works' | relative_url }}">How it works</a>
    <a class="btn" href="https://github.com/CribbNicolas/deltadictum">GitHub</a>
  </p>
</div>

A coding agent reads your code well. It cannot read the decision behind a strange-looking function,
the trap a teammate fell into last month, or the step nothing enforces. DeltaDictum (DD) keeps those as
**memories** in your repository and hands each one to the agent right before it touches what the memory
covers. Nothing at session start, nothing on the tasks it does not concern.

<div class="dd-grid">
  <div class="dd-card">
    <h3>Triggers, not search</h3>
    <p>A memory names the files, symbols, commands or words it applies to. DD matches every tool call against them and delivers only what matches, once per session.</p>
  </div>
  <div class="dd-card">
    <h3>At the action</h3>
    <p>The memory arrives inside the tool call it concerns: before the edit, before the command. A session that never touches those files never pays for it.</p>
  </div>
  <div class="dd-card">
    <h3>Captured with evidence</h3>
    <p>After a failure followed by a fix, or a correction from you, DD asks the agent to save what it learned. Proposals are validated; verified evidence activates them, the rest wait for you.</p>
  </div>
  <div class="dd-card">
    <h3>Local, shared through git</h3>
    <p>Memories are JSON files in your repo. No account, no model calls, no background process, no dependencies. Everything derived stays on your machine.</p>
  </div>
</div>

## What the agent sees

When the agent is about to edit a file a memory covers, the hook adds the memory to that tool call:

```text
DD - project knowledge (tests/store.test.js):
[TRAP] Close stores in t.after - A test that opens a store must close it in t.after: a failing
assertion otherwise leaves the handle open and node --test never ends.
```

You see one line when a session starts, with the number of live memories and how to open the review UI.
The agent's context gets nothing until it acts.

## Three steps

<ol class="dd-steps">
  <li><strong>Install the plugin</strong> in Claude Code: <code>/plugin marketplace add CribbNicolas/deltadictum</code>, then <code>/plugin install dd@deltadictum</code>. Node.js 22.16 or later.</li>
  <li><strong>Opt the project in</strong> from its root: <code>npx deltadictum init</code>. Commit the <code>.dd/</code> folder it writes.</li>
  <li><strong>Work as usual.</strong> DD asks the agent to save a memory when a fix taught it something; you can also say "save this as a trap". Review with <code>/dd:review</code>.</li>
</ol>

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

> One project, one model, a small sample: these numbers say DD is on track, not that it will do the
> same on yours. [How it is measured](guide/how-it-works.md#how-it-is-measured), and the
> [second trial](benchmarks/2026-10-v2-trial-opus-haiku.md) with Claude Opus 5.5 and Claude Haiku 5.5.

## Where next

- [Getting started](getting-started.md): install, opt in, first memory, review, share with the team.
- [Using DD well](using-dd.md): what to save, how to write a memory that fires when it should, checks, the
  review UI, troubleshooting.
- [Reference](guide/index.md): how DD works, the memory format, configuration, storage, the security boundary.
- [Harnesses](integrations/index.md): Codex, OpenCode and Grok Build.
- [Architecture](architecture/index.md): the behavioural contract, the plugin constraints, the invariants.
