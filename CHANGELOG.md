# Changelog

Notable changes to DeltaDictum (DD), newest first. Versions follow [semantic versioning](https://semver.org/);
before 1.0 a minor version may change behavior. Each version is published to npm and released on GitHub
when it reaches `main`, and CI refuses a version bump without a section here.

## [0.9.10] - 2026-10-18

- Delivery: every delivery and every check report ends with a line telling the agent the knowledge is
  advice: apply it unless the user explicitly asked for what it rules out, and then do what the user asked
  and say which memory it departs from. In the 2026-10 benchmark Haiku, with DD, refused an explicit request
  a delivered memory contradicted in 3 runs of 3; with the line it did what was asked in 6 of 6 (two such
  tasks) and still applied the memories where the request did not rule them out (6 of 6). The ledger's size
  counts the knowledge, not the line; the line's length comes out of the delivery's budget.

## [0.9.9] - 2026-10-18

- Corrections: Claude Code's own notifications are no longer recorded as user corrections. It hands a
  finished background task, a subagent's report, a reminder or a local command's output to
  `UserPromptSubmit` as a prompt, and their wording ("instead of", "should not have") matched; during the
  2026-10 benchmark an auditing subagent's report was recorded as a correction three times. The blocks
  Claude Code wraps in its own tags, and its "[SYSTEM NOTIFICATION" paragraph, are now left out before a
  prompt is read; what the user typed beside them is still read.

## [0.9.8] - 2026-10-16

- Review UI: the page updates itself as the store changes. The server watches the memories, the inbox, the
  agent's requests, the session files and the settings, and tells the open page (`/api/events`); the UI's
  own reads are left out, so a refresh never announces the next one. A "live" mark beside the DD logo says
  it is connected.
- Review UI: the views come in three groups (Dashboard and New memory; Candidates, Agent requests, Accepted
  by DD; Recent deliveries, All memories and the health queues), with the DD logo and a settings button at
  the bottom. Settings open in a dialog.
- Review UI: the dashboard is its own full-width view with charts: memories by status, what waits for a
  person, coverage, sessions and deliveries per day, the capture funnel, fires by trigger and by event, and
  the memories that fire most. The counts the header used to show live there; the header is gone.
- Review UI: Batches and Agent requests are one view: the batches the agent named, then the requests no
  batch names. New memory opens full width. The open view is kept in the address, so a reload returns to it.
- Review UI on a phone: the views are one scrolling row above the content.

## [0.9.7] - 2026-10-15

- Documentation site: rebuilt as a custom Astro site in `site/`, deployed to GitHub Pages by Actions. A
  landing page, docs with search, a table of contents and prev/next, Open Graph images, structured data and
  a sitemap. It reads the Markdown in `docs/` in place and keeps every URL the Jekyll site published.
- Benchmark tables on the site come from `docs/benchmarks/data/*.summary.json`, written from a trial's
  report by `src/eval/agent/summary.js`.
- The "How DD works" loop diagram is an SVG image instead of a Mermaid block, and every docs page has a
  description.
- A pull request that changes nothing the npm package ships no longer needs a version bump.

## [0.9.6] - 2026-10-15

- Documentation site: the loop diagram on "How DD works" runs top to bottom; six steps in a row did not
  fit the page width legibly.

## [0.9.5] - 2026-10-15

- Documentation site: the loop diagram on "How DD works", the two remaining callouts and the page
  descriptions announced in 0.9.3 are in the pages now; the edits had missed files with CRLF line endings.

## [0.9.4] - 2026-10-15

- Documentation site: the stylesheet compiles again. The variables the custom styles use are defined in
  `_sass/custom/setup.scss`, which every stylesheet the theme builds includes, instead of in the `dd`
  colour scheme alone.

## [0.9.3] - 2026-10-15

- Documentation site: a dark colour scheme of its own (amber accent, soft blue links), a landing page with
  the four ideas behind DD and the three steps to start, a diagram of the loop on "How DD works", callouts
  on the guide pages, page descriptions, and a favicon. The mark is transparent now, with a light variant
  for dark surfaces (`brand/DeltaDictum-mark-light.svg`); the README shows the right one for the reader's
  theme.

## [0.9.2] - 2026-10-15

- Session start shows the person one line in Claude Code (the hook's `systemMessage`, which the model does
  not see): how many memories are live in the project and how to open the review UI (`/dd:review`), or,
  before the first memory, how to save one. Nothing is added to the agent's context, as before; the line
  is not repeated after a compaction, and Codex, which has no such field, gets nothing.
- Documentation site: the link to the Opus and Haiku trial on "How DD works" is rewritten by Jekyll (its
  text no longer spans two lines), and the behavioural contract no longer links to the v2 design note,
  which is kept outside git.

## [0.9.1] - 2026-10-15

- Documentation site at [cribbnicolas.github.io/deltadictum](https://cribbnicolas.github.io/deltadictum/),
  built by GitHub Pages from `docs/`: a landing page, [Getting started](docs/getting-started.md) (install,
  opt in, first memory, review, sharing) and [Using DD well](docs/using-dd.md) (what to save, triggers that
  fire, checks, the review UI, troubleshooting), beside the reference pages. The package and plugin
  manifests point at it.
- README: the CI badge reads the test workflow, the install block appears once, the review UI features
  are listed.
- Tests: the maintenance test waits longer for the detached process before removing its project (Windows).

## [0.9.0] - 2026-10-14 (DD v2)

DD v2 replaces the core. Memories fire by rules (their triggers) at the action they apply to instead of
being searched for by similarity on every prompt and tool call, so DD costs about what the agent costs alone:
on this repository's 15-task agent trial, the same resolution, 7 more points of code quality and every
project requirement met, at 1% more cost; DD 0.8 reached similar quality at 46% more
([how it is measured](docs/guide/how-it-works.md#how-it-is-measured),
[why v2](docs/architecture/history.md)). A second trial on the v2 code with Claude Opus 5.5 and Claude
Haiku 5.5 at high effort ([write-up and data](docs/benchmarks/2026-10-v2-trial-opus-haiku.md)) met every
requirement in every condition with both models and kept DD the cheapest condition.

### Breaking
- **New memory format** (schema 8): one file per memory in `.dd/memories/`, with kinds `trap`, `decision`,
  `failed_approach`, `procedure` and `fact`, triggers, an optional check and a required `not_derivable`.
- **No MCP server, no resident process, no embedding model, no dependencies.** The `dd` MCP tools, the
  memory map at session start, anchors, the actions queue and the audit UI are gone.
- **Commands:** `/dd:save`, `/dd:recall` and `/dd:review` remain; `compact`, `clean`, `prospect` and
  `audit` are removed. `deltadictum init` now writes the project's opt-in (`.dd/config.json`,
  `.dd/.gitignore`, `.dd/memories/`) instead of a data directory.
- Settings `auto_accept.confidence_threshold`, `budget_tokens` and `anchors.only` and the environment
  variables `DD_DATA`, `DD_EMBED_MODEL`, `DD_RESIDENT` and `DD_RETRIEVAL` no longer exist.

### Migrating from 0.8
1. Update the plugin (Claude Code: `/plugin`), or `npm update -g deltadictum`.
2. In each project, preview and convert its store, then commit the result:
   ```bash
   npx deltadictum migrate --dry-run
   npx deltadictum migrate
   git add .dd && git commit -m "Migrate DD memories to v2"
   ```
   Every memory keeps its id; `.dd/atoms/`, `candidates/`, `archive/`, `legacy/`, `registry/` and `actions/`
   are removed once the memories are written. Pending actions are reported and dropped.
3. Open the review UI (`npx deltadictum ui`). Converted memories wait in the "Missing not_derivable" queue
   for one line saying why the code does not show them, and "Dead triggers" lists those whose files no
   longer exist.
4. Codex: run `deltadictum install --host codex --project <path>` again; it removes the MCP server block.
5. The old data directory (`~/.dd-data` or the plugin's data folder) is no longer read and can be deleted.

### Added
- Delivery by triggers (paths, symbols, commands, prompt keywords) compiled into an index, once per session
  and subagent, re-armed after a compaction.
- Checks: rules over changed files or commands, reported only when the change introduced the violation.
- Capture from the session's footprint: at the end of a turn with a failure followed by a fix, or a user
  correction, DD asks the agent to save what it learned; proposals arrive through `.dd/inbox/` and are
  answered in the same turn.
- Daily maintenance (roll-up, pruning, retirement of memories that never fire despite opportunity),
  `deltadictum health`, `recall`, `status`, `compile` and `migrate`.
- `deltadictum doctor`: whether DD is working in the project (Node, the opt-in, the index, sessions
  recorded, maintenance, what needs a person), with a hint per problem and exit 1 when there is one; a
  hook that fails never says so (L5), this does. `/dd:review` shows its summary before opening the UI.
  A trigger path is dead when it matches no tracked or untracked file; new work not yet added to git
  counts as present, ignored files do not. A converted memory stays in the "Missing not_derivable"
  queue until a person saves its line in the UI, even when an agent drafted one through the store. The
  UI's "Re-verify evidence" re-hashes a memory's evidence files at their current content (a file that is
  gone stays stale) and records the person. Batches: a proposal or request may carry `"batch": "<name>"`;
  the UI's Batches queue accepts or rejects the lot in one action, with each candidate validated as alone
  and what it could not do reported. The UI's Settings pane turns auto-accept on or off and sets the
  delivery cap (`delivery_limit`, 2,000 to 50,000 characters, default 10,000, compiled into the index) in
  `.dd/config.json`, keeping every other key the file holds. Each delivery leaves a ledger line (event,
  memories in full, memories named, characters) that rolls up into the telemetry; the UI's Dashboard shows
  sessions and tool calls, deliveries per 100 tool calls, memories and characters per delivery, how often
  the cap was reached, deliveries by event, the memories that fire most, fires by trigger dimension, check
  outcomes, which live memories were ever delivered, the last days and the capture funnel.
- `deltadictum import [--from DIR] [--dry-run]`: the project's `.claude/rules/` and `.cursor/rules/`
  files that name paths become memories delivered at those files on every harness, with the file as
  hashed evidence; always-on rules are left to `CLAUDE.md`, and a second run updates what changed.
- The review UI, `deltadictum ui`: queues, evidence, breadth, use, a dry run of triggers over recent
  sessions, and every edit and status change.
- A project opts in with its `.dd/` folder (a committed `.dd/config.json`, or a first memory): DD records
  its footprint and asks for memories from the first session, not from the first memory. `deltadictum
  init` writes the opt-in and compiles; the Codex installer writes the config when there is none.
- Health and the review UI show each memory's fires by the trigger dimension that matched, the capture
  funnel (asks, corrections, proposals stored, activated or rejected, rejections by reason) and the last
  deliveries; memories DD accepted on its own wait in their own queue until a person marks them reviewed.
- Trigger globs accept `{a,b}` alternatives (`src/**/*.{js,ts}`).
- A shell command that only reads or searches (`cat`, `sed -n`, `head`, `rg`…) is a read or search event
  in Claude Code too, as it was in Codex: a memory on a file fires when the agent reads it through Bash.
- Codex delivery through shell reads and `apply_patch`, and OpenCode delivery with the tool result; both
  are not yet verified in a live session.

### Changed
- This repository's own memories were curated against the v2 code: 25 that described mechanisms v2
  removed (the resident, the bridge, the MCP server, embeddings, the v1 store) are archived with the
  reason; the 22 that still hold were rewritten or completed with `not_derivable`, globs that match a
  tracked file, keyword phrases instead of single generic words, fresh evidence hashes, and two checks for
  the `package.json` traps (a bin path written with `./`, an unquoted `node --test` glob).

### Fixed
- The `recall` and `review` skills ran `npx deltadictum`, which fetched the published package from npm (a
  network request, and possibly another version than the hooks); they run the installed plugin's own CLI.
- The Grok manifests registered a subset of the hooks (no inbox, so `/dd:save` was never ingested there; no
  corrections, no failures); they mirror Claude Code's.
- `npm run bench:v2` read the v1 atoms the migration removed and failed before its first number; it reads
  the live memories of the v2 store when no atom is left.
- Minors found during the v2 plans, closed before the release: a ledger claim written after a torn last
  line started on that line and never counted; a session's footprint had no size cap (it now stops
  taking tool calls at 4 MB); a check whose pattern does not compile was reported as `check_timed_out`
  (now `invalid_check_pattern`); a turn check skipped files over 1 MB instead of judging their first 256
  KB, and judged files edited by events its `on` did not name; check lines were appended after the
  10,000-character delivery budget; a check that threw at Stop also lost the capture request.

## [0.8.6] - 2026-10-06

### Security
- The shipped `npm-shrinkwrap.json` pinned dependency versions with published advisories, so `npm audit` flagged
  every install: `@modelcontextprotocol/sdk` (OAuth client, high), `proxy-addr` (critical), `ip-address` and
  `fast-uri` (moderate) through the SDK's HTTP transport, and `sharp` (high) through
  `@huggingface/transformers`. DD uses none of the affected paths (it speaks MCP over stdio and processes no
  images), but they are now updated: the SDK to 1.32.1, with `^1.31.0` as its minimum, and `sharp` to 0.35.5.
  `npm audit` reports no vulnerabilities.

### Fixed
- The release-notes script found a version's CHANGELOG section with a regular expression built from the
  version string; it now matches the heading as a plain prefix (CodeQL: regular expression injection).
- The agent benchmark linked the shared `node_modules` through `cmd /c mklink` with paths from the
  environment; it now creates the junction or symlink with `fs.symlink`, without a shell (CodeQL: shell
  command built from environment values).
- The credential-detection test kept a synthetic Google API key in one piece, which GitHub secret scanning
  reported as a leaked key; the fixture is now split so scanners do not match it.

### Changed
- The Codex guide's install example uses a generic project path.
- `.claude/settings.json`, written by a local plugin install, is ignored by git.

## [0.8.5] - 2026-10-06

### Changed
- The package, plugin and marketplace descriptions say what DD is in plain words: reviewed project knowledge
  for coding agents, recalled before each action. "Next-action doctrine" is gone from every manifest.
- The README opens with a short recording of the audit UI on a demo project: memories by type, a decision
  with its rationale and evidence, a candidate waiting for review and the auto-accept setting.
- This project's own memories were reviewed against the 0.8.x code: 18 still hold and had their evidence
  re-verified, seven were revised (the hook cache, the Codex managed block, embeddings, the MCP retrieve view,
  the CLI dispatch before `openStore()`, the data directory and where the resident writes telemetry) and one
  that described the removed `auto_admit` block was archived.

## [0.8.4] - 2026-10-05

### Fixed
- Reinstalling DD into a Codex project dropped the per-tool preferences written inside DD's managed block
  (`[mcp_servers.dd.tools.<tool>]`, such as `approval_mode`); they are now kept.
- Reinstalling into a Codex project left DD's existing hooks with their old settings, so an upgrade never
  received a raised limit such as SessionStart's `additionalContextLimit` of 24000. DD's own
  handlers are now refreshed in place; other handlers and matcher groups are kept.
- Reinstalling into a Codex project from another Node or DD directory (a source checkout moved to a global
  install) added a second set of hooks beside the old one, so DD ran twice per event. DD's handlers are now
  recognised by runner and event, replaced in place, and a duplicate left by an earlier install is removed.
- `check-codex.mjs` failed with `audit_project_mismatch` on a machine with no resident running yet: its
  first `status` ran before the resident it started had registered, and named the keyless default address.
  It now asks again once the resident answers, and reports an HTTP failure as `audit_http_<status>`.
- DD's inactive notices pointed at a README section that no longer exists; they now point at
  README > "Troubleshooting".

### Changed
- The README covers what a new user needs: a quickstart, compatibility and requirements, installation for
  each harness, the commands, the memory types and the common settings with their defaults. The rest moved
  to `docs/guide/`: how DD works, memories (types, fields, lifecycle, flags), every configuration setting
  and environment variable, the resident process and its troubleshooting, storage and the security
  boundary. Other MCP hosts have their own guide, and the developer notes moved to CONTRIBUTING.md.
- The npm package ships `docs/guide/` and carries search keywords.
- Development plans and specs (`docs/plans/`, `docs/specs/`, `docs/superpowers/`) are ignored by git.

## [0.8.3] - 2026-09-30

### Fixed
- `deltadictum status` failed with `ddDir is not defined`; it now prints the project's paths and counts.
- An unknown command, `--help` or `--version` no longer creates `.dd/` and a data directory in the current
  directory before refusing. `help` and `--version` are now commands.
- `engines` claimed Node 22 and later, but DD needs `node:sqlite` with FTS5, which Node ships from 22.16.0.
  On an older Node the session start now says why DD is inactive instead of staying silent.
- The auto-accept sweep no longer admits a candidate flagged as a suspected duplicate of another memory:
  the flag exists so a person reads the two side by side.
- The MCP server reported version 0.3.1 whatever the installed version.
- `similar` accepts a topic key as well as an id, as `get` does.
- The model decision runner (`npm run eval:models`) offered no correct choice for three of its 28
  scenarios; it now offers every decision the scenarios expect.

### Removed
- Dead code: `src/engine/v4/forms.js`, `fitLines`, unused path helpers and constants, and the `auto_admit`
  config block, which nothing read.
- The completed design and plan for actions and the legacy state (`docs/superpowers/`); the behavior is
  documented in `docs/DD.md`.

### Changed
- CI lints for undefined and unused names, tests on the oldest supported Node (22.16.0) and on Node 24, runs
  the stress suite, checks the published file list and registry signatures, and reports macOS without
  blocking. Publishing tags the version and writes its GitHub release from this file.
- Documentation brought in line with the code: auto-accept, the recall budget, the evaluation corpus,
  embeddings and the resident process.
- Auto-accept stays on by default, now documented in the README with how to turn it off or move its
  threshold (the audit UI's Settings panel, or `auto_accept` in `.dd/config.json`).
- TODO.md lists the review's proposals, the repository settings to change and what was not verified.

## [0.8.2] - 2026-09-29

### Changed
- TODO records the state after 0.8.0: open items and the ideas measured and rejected.

## [0.8.1] - 2026-09-29

### Changed
- The project's own memories open with their action, so a headline is useful on its own.

## [0.8.0] - 2026-09-29

### Added
- Pull-first delivery: up to eight one-line pointers per prompt or tool call to memories either ranking places
  in its top 20, once per session each; an explicit `retrieve` returns its fused top five even below their
  floors; a non-English prompt asks the agent to retrieve in English. Must-recall on the golden sets' test
  halves reached 0.90 (Patriark) and 0.94-0.96 (supermem).
- `npm run bench:pull`, a benchmark of what the agent ends up with, push and pull together.
- `DD_EMBED_MODEL=multilingual-e5-base` selects the larger embedding model.

### Changed
- The budget is counted on what the agent reads, not on the serialized result.
- A file beside a scoped one (its test, a sibling module) keeps the memory applicable.

## [0.7.0] - 2026-09-28

### Added
- Hybrid ranking: reciprocal rank fusion of full-text and dense rankings plus anchor hits.
- A trigger-led memory map at session start.
- Anchor actions apply themselves once validated (retrieval metadata only; `auto_apply_retrieval_metadata`).

### Changed
- Research tools (WebSearch, WebFetch) no longer trigger retrieval.

## [0.6.0] - 2026-09-27

### Added
- Golden sets extracted from real traffic, split into tuning and test halves, stored outside git.

### Changed
- Quieter on host tools and acknowledgements, looser on prompts.

## [0.5.0] - 2026-09-27

### Added
- Stale actions can be moved to the live revision of their topic.
- `get` says when a memory its anchors missed was pulled in the session.

### Changed
- Packs fill breadth first: every matching memory joins in its most compact form before any grows.
- Recall defaults (800-token budget, semantic floor 0.035) reach existing projects.

## [0.4.0] - 2026-09-26

### Added
- Actions (archive, restore, delete, legacy, merge, split, retopic, resolve) filed by the agent and applied
  by a person in the audit UI; the `legacy` state; revision requests; the `/dd:*` command skills.
- Anchors: deterministic delivery by keyword, anchor file or component, validated at write time and required
  on agent proposals.
- The memory map at session start; hubness discount in embedding activation.
- CI on Ubuntu and Windows, a version check on every PR, and npm publishing with provenance.

### Fixed
- Claude Code tool outcomes are recorded from `PostToolUse` and `PostToolUseFailure`.

## [0.3.1] - 2026-09-23

### Added
- One shared resident process per machine holding the embedding model; embeddings are required and DD says
  when it is inactive.

### Fixed
- The published package works in Claude Code, Grok Build, OpenCode and Codex; the audit UI is closed to
  other accounts on the machine.

[0.9.0]: https://github.com/CribbNicolas/deltadictum/compare/v0.8.6...v0.9.0
[0.8.6]: https://github.com/CribbNicolas/deltadictum/compare/v0.8.5...v0.8.6
[0.8.5]: https://github.com/CribbNicolas/deltadictum/compare/v0.8.4...v0.8.5
[0.8.4]: https://github.com/CribbNicolas/deltadictum/compare/v0.8.3...v0.8.4
[0.8.3]: https://github.com/CribbNicolas/deltadictum/compare/696f567...v0.8.3
[0.8.2]: https://github.com/CribbNicolas/deltadictum/compare/7606bcd...cc871cf
[0.8.1]: https://github.com/CribbNicolas/deltadictum/compare/932d275...7606bcd
[0.8.0]: https://github.com/CribbNicolas/deltadictum/compare/43c555c...932d275
[0.7.0]: https://github.com/CribbNicolas/deltadictum/compare/b5a79d0...43c555c
[0.6.0]: https://github.com/CribbNicolas/deltadictum/compare/558919c...b5a79d0
[0.5.0]: https://github.com/CribbNicolas/deltadictum/compare/2d2862d...558919c
[0.4.0]: https://github.com/CribbNicolas/deltadictum/compare/b9318aa...2d2862d
[0.3.1]: https://github.com/CribbNicolas/deltadictum/commit/b9318aa
