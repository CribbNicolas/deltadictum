# Changelog

Notable changes to DeltaDictum (DD), newest first. Versions follow [semantic versioning](https://semver.org/);
before 1.0 a minor version may change behavior. Each version is published to npm and released on GitHub
when it reaches `main`, and CI refuses a version bump without a section here.

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

[0.8.3]: https://github.com/CribbNicolas/deltadictum/compare/696f567...HEAD
[0.8.2]: https://github.com/CribbNicolas/deltadictum/compare/7606bcd...cc871cf
[0.8.1]: https://github.com/CribbNicolas/deltadictum/compare/932d275...7606bcd
[0.8.0]: https://github.com/CribbNicolas/deltadictum/compare/43c555c...932d275
[0.7.0]: https://github.com/CribbNicolas/deltadictum/compare/b5a79d0...43c555c
[0.6.0]: https://github.com/CribbNicolas/deltadictum/compare/558919c...b5a79d0
[0.5.0]: https://github.com/CribbNicolas/deltadictum/compare/2d2862d...558919c
[0.4.0]: https://github.com/CribbNicolas/deltadictum/compare/b9318aa...2d2862d
[0.3.1]: https://github.com/CribbNicolas/deltadictum/commit/b9318aa
