# Contributing to DeltaDictum

DD is source-available under the [PolyForm Shield License 1.0.0](LICENSE). Issues and pull requests are
welcome.

## Before proposing a design

DD is a plugin for coding-agent harnesses, not a service. Read
[`docs/architecture/plugin-constraints.md`](docs/architecture/plugin-constraints.md) first: a proposal
that breaks one of its seven limits (hooks are ephemeral processes, one resident per machine, three
dependencies, per-harness hook contracts, never blocking the host, single-developer data volumes,
local-first) is out of scope however good it is. [`CLAUDE.md`](CLAUDE.md) lists the properties every
change keeps, and [`docs/architecture/invariants.md`](docs/architecture/invariants.md) the invariants.

Everything in the repository is written in English: code, comments, documentation and commit messages.

## Setup

Node.js 22.16 or later (DD needs `node:sqlite` with FTS5).

```bash
npm ci
```

Run DD from the checkout inside Claude Code with `claude --plugin-dir <checkout>`; see
[Developing DD](README.md#developing-dd) for the resident process and test isolation.

## Checks

A pull request passes these in CI; run them before pushing:

```bash
npm run lint          # undefined and unused names (ESLint, fetched by npx)
npm test              # full suite
npm run test:stress   # 2,000 knowledge files, parallel hooks, resident reuse
npm run eval          # deterministic retrieval replay; gate: f1 >= 0.9, exact >= 90%, abstention f1 >= 0.9
```

A change to ranking, floors or delivery is measured on the golden sets (`npm run bench`,
`npm run bench:pull`; see [TODO.md](TODO.md)) as well as the replay. A change to the hook contract is
checked against Claude Code and the `--codex` path in `src/hooks/run.js`.

## Versions and releases

Every pull request raises the version in `package.json` and `.claude-plugin/plugin.json` above `main`
and adds its section to [CHANGELOG.md](CHANGELOG.md); CI checks all three. Merging to `main` publishes the
version to npm with provenance, then tags it and writes its GitHub release from the changelog section.
