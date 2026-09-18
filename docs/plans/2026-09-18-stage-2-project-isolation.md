---
artifact_class: authored
owner_domain: plans
artifact_type: plan
stability: draft
last_validated: 2026-09-18
depends_on:
  - architecture/plugin-constraints.md
  - architecture/invariants.md
  - plans/2026-09-18-stages-index.md
do_not_co_load_with: []
---

# Stage 2 — Project isolation: the home directory is not a project

## What DD is, and what it cannot be

**DD is a plugin for coding-agent harnesses — Claude Code, Codex, Grok, opencode — not a service.**
Full statement in [`architecture/plugin-constraints.md`](../architecture/plugin-constraints.md).

| | Limit | Consequence |
|---|---|---|
| L1 | Hooks are ephemeral Node processes; `PreToolUse` runs on every tool call | Nothing warm on the hot path |
| L2 | No guaranteed persistent process; audit UI and MCP server are both optional | No required background worker |
| L3 | Two dependencies, Node ≥ 22 | **No embeddings, no ML libraries** |
| L4 | The hook contract differs per harness | A veto is not portable |
| L5 | A hook failure must never block the host | Every gate needs a defined failure direction |
| L6 | Single-developer volumes | No online learning |
| L7 | Local-first: git plus a derived SQLite index | No cross-user aggregation |

## Invariants this stage must not break

**This stage exists because one is already broken.** From
[`architecture/invariants.md`](../architecture/invariants.md):

> **INV-01: Project isolation is mandatory.** Every project has an isolated knowledge scope. The
> project identifier is resolved from the repository and is the first filter on every read and every
> write.

Also in force and not to be disturbed: model output never mutates state; retrieval is project-scoped
first; one effective memory per `topic_key`; a hook failure never blocks the host.

## Start here: confirm the ground before writing code

**This document may be wrong.** It was written against the repository at a point in time, and earlier
stages move code. Run the checks below first. If any result disagrees with what the *Starting state*
section claims, **stop and report the difference** instead of proceeding — a plan that no longer
matches the code is information, not an obstacle to route around.

This is not ceremony. Executing this plan has already produced two cases where it mattered: a stage
described one unreachable handler where there were two plus a routing indirection, and a stage
instructed a rule that turned out to be wrong once implemented.

```bash
# The two halves of the collision. Expect: .dd accepted as a marker, and the
# per-user data base living at ~/.dd.
grep -n "exists(join(dir" src/project.js
grep -n "dataBase" src/project.js

# The failing test. Expect: red, in isolation, with ENOENT on .dd/.gitignore.
node --test tests/store/transactions.test.js

# What the bug already did on this machine. Expect: a project_id under the home.
node scripts/check-home-artifacts.mjs
```

## Starting state

Two facts that are individually reasonable and together are a bug.

**One.** `findRepoRoot` walks upward looking for a repository marker
(`src/project.js:16-24`):

```js
if (await exists(join(dir, '.dd')) || await exists(join(dir, '.git'))) return dir;
```

**Two.** The per-user data base directory **is `~/.dd`** (`src/project.js:35`):

```js
const dataBase = process.env.GROK_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.dd');
const dataDir  = process.env.DD_DATA || join(dataBase, `${slug}-${identity}`);
```

So the per-user cache directory and the per-project knowledge marker are the same path shape. Opening a
store from any path under the home directory that is not itself inside a repository walks up, finds
`~/.dd`, and **returns the home directory as the project root**.

This is not theoretical. On the machine where the audit ran, `~/.dd/config.json` exists and contains:

```json
{ "project_id": "walle-86f2cb6e", "budget_tokens": 600, ... }
```

The home directory was registered as a DD project, named after the user's home folder. No knowledge
leaked — there is no `atoms/` or `registry/` there — but the mechanism is live, and two unrelated
non-repository directories under the home would share one store.

**It is also the cause of the repository's only red test.** `tests/store/transactions.test.js:37`
creates a temp directory, opens two stores in parallel, and reads `<root>/.dd/.gitignore`. It fails
with `ENOENT` because `ddDir` resolved to `~/.dd`, not to the temp root. The test fails **in isolation
as well as in the suite**, so it is a real bug and not cross-test contamination.

For reference, the file the test expects is written at `src/store/create-store.js:32` with flag `wx`,
so it is created once and an existing project's ignore policy is preserved.

## What changes, and why

Both halves of the collision get fixed. Fixing only one leaves the other able to reproduce it.

### 1. Move the per-user data base out of `~/.dd`

`join(homedir(), '.dd')` becomes a distinct path — `~/.dd-data`, or a platform-appropriate cache
location. The ambiguity disappears at the root: a `.dd` directory then always means "a project lives
here".

This is cheap because **the SQLite index is rebuildable from git**. `refresh()` in
`src/store/create-store.js:53-57` compares `index_format` and a source fingerprint and calls
`reindex()` when either differs; `reindex()` reads the atoms, registry and relations from git and
rebuilds. A moved cache costs local telemetry — observations, feedback, retrieval events, session
deliveries — which is already bounded to 90 days (`src/store/paths.js:80-82`). It costs no knowledge.

`DD_DATA`, `CLAUDE_PLUGIN_DATA` and `GROK_PLUGIN_DATA` keep precedence and are untouched.

### 2. Harden `findRepoRoot`

Three changes, each independently sufficient to stop the observed failure and worth having together:

- **Prefer `.git`.** It is the unambiguous repository marker.
- **Accept `.dd` only when it looks like a project.** A project `.dd` holds `atoms/`, `candidates/`,
  `registry/` or a `config.json` carrying a `project_id`. The data base holds `<slug>-<hash>/`
  directories. These are distinguishable without guessing.
- **Never let an ancestor at or above the home capture a directory beneath it.** Stop the upward walk
  before the home. The rule is about capture, not about the home being special: a directory that
  contains everything must not claim the work inside it.

  Note what this does **not** say. An earlier draft of this document instructed "never resolve to the
  home directory", and implementing it showed that to be wrong: starting there is the user pointing at
  it deliberately, and refusing would break a legitimate if unusual case while fixing nothing. Write
  the test against capture-from-below, not against the home as a return value.

### 3. Report the existing damage; do not clean it silently

`~/.dd/config.json` and `~/.dd/.gitignore` are artifacts of this bug. `~/.dd/<slug>-<hash>/` is
legitimate cache.

**Nothing under the home directory is deleted automatically.** DD does not touch files outside the
project it was invoked in, and a fix for an isolation bug is a poor moment to start. Ship an explicit
command in `scripts/` that reports what it found and removes only when asked, and explain in this
document what a user should expect to see.

## Files

- `src/project.js` — both halves of the fix
- `scripts/` — new report-and-clean command for the stray home artifacts
- `tests/store/transactions.test.js` — **must pass without being modified.** If it has to be edited to
  go green, the fix is wrong; the test describes correct behaviour.
- New test file for resolution cases (see below)
- `README.md` — the cache directory paragraph (currently around line 111)
- `docs/architecture/project-cognition.md` — the persistence and concurrency section
- `docs/architecture/invariants.md` — INV-01 may now cite how resolution is enforced

## Tests

Write the reproduction first and watch it fail for the right reason — assert on the **resolved root**,
not on a downstream symptom, so the red is unambiguous.

| Case | Expectation |
|---|---|
| Temp directory under the home, no `.git`, no `.dd` | Resolves to itself, **never** to the home |
| Directory inside a real git repository | Resolves to the repository root |
| Project with `.dd` but no `.git` | Resolves to that project |
| Nested project inside another project | Resolves to the innermost |
| `DD_DATA` set explicitly | Still wins, unchanged |
| Two parallel first opens in one directory | One identity, and `<root>/.dd/.gitignore` exists |

The last row is the existing `transactions.test.js` case.

## Verification

```bash
npm test                                      # ZERO failures — the first clean suite of this plan
node --test tests/store/transactions.test.js  # also clean in isolation
npm run eval                                  # unchanged: 24/24, f1 1.0, 2182 tokens
```

Then confirm by hand that a store opened from a scratch directory under the home creates `.dd` **in
that directory**, and that `~/.dd-data` (or the chosen path) holds only `<slug>-<hash>/` entries.

## Risks and what not to do

- **The real risk is breaking resolution in a legitimate case** — a project that has a `.dd` and no
  `.git`, or a monorepo subdirectory. The test table above is the mitigation; do not shorten it.
- **Do not delete anything under the home automatically**, including during tests. A test that removes
  `~/.dd` will eventually run on someone's real machine.
- **Do not modify `transactions.test.js` to make it pass.**
- Existing installs will rebuild their index on first run after the move. That is expected and cheap;
  say so in the commit message so it is not mistaken for data loss.

## Done when

- `findRepoRoot` cannot return the home directory, and the data base no longer lives at `~/.dd`.
- The full suite is green, in aggregate and in isolation.
- The cleanup script exists, reports before acting, and acts only when asked.
- README and the architecture document describe the new paths.
- One commit explaining that this was an INV-01 violation, not a test annoyance.

## Depends on / unblocks

Depends on nothing; independent of stage 1. Unblocks every later stage, which would otherwise inherit a
project resolution that can silently merge unrelated directories into one store — and would be measured
against a suite that is not green.

---

## Outcome

Executed in commit `3308828`. **197 tests, 197 passing** — the first fully green suite of this plan.
Replay unchanged at 24/24, f1 1.0, 2182 tokens. The pre-existing red test passed without being
modified, which was the stated acceptance criterion.

What the plan got wrong, and what a clean-context run should know:

- **The home rule as first written was wrong**, corrected above. The first test asserted the home could
  never be returned; implementation showed the real rule is about capture from below.
- **Why the bug reproduced in a temp directory** was not stated and is the key to writing the test: on
  Windows `os.tmpdir()` is itself under the home, so a `mkdtemp` there walks up into `~/.dd`. On Linux
  and macOS `/tmp` is not under the home, so the incident would not reproduce from `tmpdir()` at all.
  The tests use a synthetic boundary instead of the real home, so they exercise the rule on every
  platform and create nothing under the user's actual home.
- **`config.json` lives in `ddDir`, not `dataDir`**, which is what makes a project store and a cache
  directory distinguishable without guessing. The marker list is `atoms`, `candidates`, `registry`,
  `config.json`.
- `exists()` already existed in `src/project.js`; no new helper was needed.
