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
[Developing DD](#developing-dd) below for the resident process and test isolation.

## Developing DD

Run Claude Code from a checkout as a local plugin, `claude --plugin-dir <checkout>`, so the session gets the
same hooks, MCP server and skills as a marketplace install. Hooks registered by hand in
`.claude/settings.local.json` (with the root `.mcp.json`) bring no skills and miss hook events added to
`hooks/hooks.json` later; do not combine them with `--plugin-dir`, or every hook runs twice.

After editing `src/`, the resident refuses hooks until it is replaced; the next prompt or session start
does that. The session's MCP server keeps its old code: its answers say so, and `/mcp` reconnects it.

Tests and install checks that start DD must not replace the machine's resident: set
`DD_RESIDENT_REGISTRY` to a temporary file (or `DD_RESIDENT=0`) and stop what they started.

Plans, specs and other working notes written while developing stay out of the repository:
`docs/plans/`, `docs/specs/` and `docs/superpowers/` are ignored by git.

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
