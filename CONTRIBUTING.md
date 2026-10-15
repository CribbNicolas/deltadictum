# Contributing to DeltaDictum

DD is source-available under the [PolyForm Shield License 1.0.0](LICENSE). Issues and pull requests are
welcome.

## Before proposing a design

DD is a plugin for coding-agent harnesses, not a service. Read
[`docs/architecture/plugin-constraints.md`](docs/architecture/plugin-constraints.md) first: a proposal
that breaks one of its seven limits (hooks are ephemeral processes, no resident process, no runtime
dependency, per-harness hook contracts, never blocking the host, single-developer data volumes,
local-first) is out of scope however good it is. [`CLAUDE.md`](CLAUDE.md) lists the properties every
change keeps, and [`docs/architecture/invariants.md`](docs/architecture/invariants.md) the invariants.

Everything in the repository is written in English: code, comments, documentation and commit messages.

## Setup

Node.js 22.16 or later (DD uses `node:sqlite` with FTS5). DD has no runtime dependency; `npm ci` installs
nothing it needs to run.

## Developing DD

Run Claude Code from a checkout as a local plugin, `claude --plugin-dir <checkout>`, so the session gets the
same hooks and skills as a marketplace install. Do not also register DD's hooks by hand in
`.claude/settings.local.json`, or every hook runs twice; disable an installed DD plugin for the project
while developing. Every hook is a new process, so an edit to `src/` takes effect at the next hook.

Tests run with `--import ./tests/helpers/isolate-data.js` (the npm scripts add it), which turns off the
daily maintenance run a session start would otherwise detach.

Plans, specs, research notes and other working notes written while developing stay out of the repository:
`docs/plans/`, `docs/specs/`, `docs/superpowers/` and `docs/research/` are ignored by git.

## Checks

A pull request passes these in CI; run them before pushing:

```bash
npm run lint          # undefined and unused names (ESLint, fetched by npx)
npm test              # full suite, including the engine's equivalence with the bench reference
npm run test:stress   # concurrent hook processes claiming the same memories
```

A change to matching or delivery is measured with `npm run bench:v2` (delivery over the recorded agent
trial, and hook latency), and one that may change what agents do, with the agent trial
(`src/eval/agent/run.js`, which spends model usage). A change to the hook contract is checked against
Claude Code, the `--codex` path (`src/hooks/v2/codex.cjs`) and the OpenCode adapter.

## Versions and releases

Every pull request raises the version in `package.json` and `.claude-plugin/plugin.json` above `main`
and adds its section to [CHANGELOG.md](CHANGELOG.md); CI checks all three. Merging to `main` publishes the
version to npm with provenance, then tags it and writes its GitHub release from the changelog section.
