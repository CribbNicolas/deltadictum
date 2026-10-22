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
acts: the decisions behind the code, the traps someone already fell into, the steps nothing enforces.

Each memory says when it applies, what to do, and why the code alone would not tell the agent. DD delivers
it when the agent reads, edits or runs something the memory covers, once per session, and stays silent
otherwise. Memories are JSON files in your repository, shared through git; everything else stays on your
machine. No account, no model calls, no background process, no dependencies.

**Documentation: [cribbnicolas.github.io/deltadictum](https://cribbnicolas.github.io/deltadictum/)**, with
the benchmark on its [landing page](https://cribbnicolas.github.io/deltadictum/#measured).

## Install

You need [Node.js](https://nodejs.org) 22.16 or later and a git repository.

**Claude Code**:

```text
/plugin marketplace add CribbNicolas/deltadictum
/plugin install dd@deltadictum
```

**Codex**:

```bash
npm install -g deltadictum
deltadictum install --host codex --project "<absolute-project-path>"
```

Then open the project in Codex, trust it, and trust DD's hooks in `/hooks`.

**OpenCode**:

```bash
npm install -g deltadictum
deltadictum install --host opencode --project "<absolute-project-path>"
```

**Grok Build** (preview, not yet verified in a live session): `grok plugin install CribbNicolas/deltadictum --trust`.

**Cursor** (preview, not yet verified in a live session):

```bash
npm install -g deltadictum
deltadictum install --host cursor --project "<absolute-project-path>"
```

Then open the project in Cursor and trust the workspace: Cursor runs a project's hooks only in a trusted one.

Then opt the project in from its root, and commit what it writes:

```bash
npx deltadictum init
git add .dd && git commit -m "Opt the project into DeltaDictum"
```

A project without a `.dd/` folder is left alone. [Getting started](https://cribbnicolas.github.io/deltadictum/getting-started)
walks through each harness, the first memory and what you see at every step.

## Use

Work as usual. When a fix teaches the agent something the code does not show, DD asks it to save a memory;
you can ask for one too (`/dd:save`, or "save this as a trap"). Review what was saved with `/dd:review`,
which opens a local review UI. `npx deltadictum doctor` tells you whether DD is working in the project.

- [Using DD well](https://cribbnicolas.github.io/deltadictum/using-dd): what belongs in a memory, triggers
  that fire when they should, checks, the review UI, troubleshooting.
- [Commands](https://cribbnicolas.github.io/deltadictum/commands): in the session, by harness, and the
  command line.
- [How DD works](https://cribbnicolas.github.io/deltadictum/guide/how-it-works),
  [Memories](https://cribbnicolas.github.io/deltadictum/guide/memories),
  [Configuration](https://cribbnicolas.github.io/deltadictum/guide/configuration),
  [Storage](https://cribbnicolas.github.io/deltadictum/guide/storage),
  [Security boundary](https://cribbnicolas.github.io/deltadictum/guide/security) and the
  [behavioural contract](https://cribbnicolas.github.io/deltadictum/DD).

The same pages are in [`docs/`](docs/); for language models, the site serves
[llms.txt](https://cribbnicolas.github.io/deltadictum/llms.txt) and
[llms-full.txt](https://cribbnicolas.github.io/deltadictum/llms-full.txt). Changes: [CHANGELOG](CHANGELOG.md). Contributing:
[CONTRIBUTING](CONTRIBUTING.md).

## Next to `CLAUDE.md`

Keep `CLAUDE.md` for what every session needs. DD is for knowledge that applies to specific files,
commands or symbols: it is delivered at the action instead of at every session start, so a memory about
one file costs nothing in the sessions that never touch it. `npx deltadictum import` turns the
`.claude/rules/` and `.cursor/rules/` files that name paths into memories.

## Security and license

The review UI listens on a loopback address only and answers only a browser holding the key it prints;
proposals carrying credentials or unsafe content are refused ([Security boundary](https://cribbnicolas.github.io/deltadictum/guide/security)).
Report vulnerabilities as described in [SECURITY.md](SECURITY.md).

DD is source-available under the [PolyForm Shield License 1.0.0](LICENSE), not an open-source license.
You may install and use it for any purpose, including in paid work and inside a company, and you may
change it and share copies with the license attached. You may not sell it, offer it as a hosted or
managed service, or use it to provide any product that competes with DD. For other terms, contact the
author through the [repository](https://github.com/CribbNicolas/deltadictum).
