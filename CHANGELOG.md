# Changelog

Notable changes to DeltaDictum (DD), newest first. Versions follow [semantic versioning](https://semver.org/):
from 1.0 on, a change that breaks a memory, a setting or a command takes a major version. Each version is
published to npm and released on GitHub when it reaches `main`, and CI refuses a version bump without a
section here.

## [1.1.0] - 2026-10-22

- Cursor, in preview: `deltadictum install --host cursor --project PATH` writes DD's hooks into the
  project's `.cursor/hooks.json` (PowerShell commands on Windows, as Cursor runs them), the `dd-save`,
  `dd-recall` and `dd-review` skills into `.agents/skills/`, where Cursor discovers them, and the AGENTS.md
  block. The hooks run with `--cursor`, and DD reads Cursor's payload (`src/hooks/cursor.cjs`): memories
  reach the agent before the tool call through `preToolUse`'s `additional_context` and at the prompt
  through `beforeSubmitPrompt`'s, a `Write` to an existing file is an edit, failures arrive through
  `postToolUseFailure`, and Stop answers with a `followup_message`. DD never answers a permission, a
  delivery stays within the 10,000 characters Cursor accepts, and every answer is valid JSON, so a
  Cursor permission hook is never blocked by DD. The shapes were read from the Cursor CLI's source
  (2026.10.19), not yet from a recorded session.
- Review UI: an internal error no longer returns the exception's message to the page. The page says to look
  at the terminal running the UI, and the error is written there (a CodeQL finding, stack-trace exposure).
- Site: `fflate` is overridden to 0.7.5, the patched release of the line `satori` pins, for
  GHSA-px8p-9vwx-vf98. It only ran while the site was built; nothing published to npm used it.

## [1.0.1] - 2026-10-22

- Review UI: the dashboard's large gradient number no longer cuts its last digit.
- Site: on the landing, the seal's tick draws without a dot showing before it, each teammate in "The agent
  gets it in time" lights up as its packet arrives, and the 1,883 counter no longer cuts its last digit.

## [1.0.0] - 2026-10-22

The first stable release. Claude Code, Codex and OpenCode are supported; Grok Build is in preview.

- Codex and OpenCode are supported: install, save, delivery and recall verified in live sessions
  (codex-cli 0.163 and OpenCode 1.19.3), and a memory saved in one is recalled in the other.
  `deltadictum install --host opencode` writes the plugin entry into `opencode.json`, the `dd-save`,
  `dd-recall` and `dd-review` skills into `.opencode/skills/` and the AGENTS.md block. The OpenCode adapter now ingests a memory the agent writes into `.dd/inbox/` and adds
  DD's answer to that write's result; before, nothing read it.
- Grok Build: its hooks run with `--grok`, and DD reads Grok's own payload (camelCase fields, `read_file`,
  `search_replace`, `run_terminal_command`), mapped from its hook guide in `src/hooks/grok.cjs`. Before, a
  Grok tool call fired nothing. Grok Build is in preview: not yet verified in a live session.
- Capture: a proposal whose `evidence` or `triggers` is a single object instead of a list is read as a list
  of one, as models other than Claude often write it.
- Evidence: a file is hashed as text with CRLF line endings read as LF, so a checkout with
  `core.autocrlf` no longer shows evidence as stale on one machine and fresh on another. Binary files are
  hashed as they are, and a hash recorded before still matches the file it was taken from.
- Settings: the review UI's Settings panel changes every setting, the project id included, and this
  machine's own in `.dd/local/settings.json` (never committed): daily maintenance on or off, and recording
  what the harness sends each hook to `.dd/local/payloads.jsonl`. `DD_MAINTENANCE=0` and
  `DD_CAPTURE_PAYLOADS` still work for one process, as CI and tests need.
- Review UI: the site's look (dark surfaces, gold for what waits for a person), views grouped in the
  sidebar, and settings in a panel from the left. The dashboard is one page of sections that play in as
  they scroll into view: live memories and what waits for you, the last seven days drawn as a line,
  coverage, the store by status, kind and area, the capture funnel, the memories that fire most, delivery
  size against the cap, and blind spots: files the agent keeps opening that no memory covers.
- Docs: the README keeps the install steps and points to the site for the rest. The reference pages say
  each thing once: the trigger fields and check rules live in Memories, Using DD well keeps the guidance,
  and the behavioural contract ends with DD's limits. No behavior changes.
- Site: a new landing and code blocks with harness tabs, built with the page so nothing shifts as it
  loads; `llms.txt` and `llms-full.txt` give language models the docs in one place.

## [0.9.14] - 2026-10-21

- Agent requests: besides archive and revise, the agent can ask to re-verify stale evidence, merge one
  memory into another (`"into"`) and delete memories that are already archived or superseded. Archive,
  re-verify and delete take up to 200 targets in one request. Each waits for a person: accepting its batch
  carries it out (deletions last), and a request outside a batch has an Apply button in the review UI.
- Capture: a proposal that names a path at the end of a sentence, or a percentage, is no longer refused
  as generic advice.
- Review UI: `retire.after_sessions` is a setting in the Settings pane, beside auto-accept and the
  delivery cap; a value out of bounds (1 to 1,000) counts as unset.
- Docs: every page follows the harness chosen in the menu (Claude Code, Codex, OpenCode or Grok Build),
  remembered across pages; the harness guides moved into Getting started and How DD works, and the
  package no longer ships `docs/integrations`. Commands have their own page. The loop in How DD works
  follows its diagram, and benchmark figures left the docs.
- The `migrate` command is gone, with the code only it used: the converter, the exemptions and review
  queue of converted memories, and the matching doctor and init checks. The Codex installer no longer
  writes a `config.toml` block; a project's `config.toml` is left alone. DD's own files lost
  their version in the name: the hooks are in `src/hooks/` and the compiled index in
  `.dd/local/compiled/`, rebuilt at the next session start; the old `.dd/local/v2/` can be deleted.

## [0.9.13] - 2026-10-21

- Code comments no longer cite design notes and plans that are not in the repository. No behavior
  changes.

## [0.9.12] - 2026-10-20

- The package no longer ships `docs/architecture`: development notes, benchmark write-ups and benchmark
  data left the repository and its history. The plugin's limits are stated in `CLAUDE.md` and
  `docs/DD.md`; the site keeps the old architecture and benchmark URLs as redirects.

## [0.9.11] - 2026-10-20

- Corrections: a session's first prompt is no longer recorded as a user correction; a prompt counts only
  once the session has a tool call or a turn behind it. "Do not change any code" in a first prompt matched
  the correction patterns, and the Stop request that followed cost the turn: in the 2026-10 benchmark 12
  runs in 78 took the extra turn with each model, and in two Haiku's reply replaced its review. On Codex
  that request blocks the Stop.
- Delivery: the advisory line that closes every delivery and check report also says that a problem the
  knowledge shows outside the task is reported, not fixed. A memory stating a rule the code breaks read as
  work, and Haiku fixed it inside unrelated tasks.
- With both, Haiku with DD resolved 99% of the benchmark's 26 tasks (92% before), scored 97% on quality
  (94%) and met 98% of the project requirements (96%), at 11% less cost per task; Opus kept its results and
  cost 4.5% less. No run took the false correction turn (24 of 156 before).

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
  text no longer spans two lines), and the behavioural contract no longer links to a design note kept
  outside git.

## [0.9.1] - 2026-10-15

- Documentation site at [cribbnicolas.github.io/deltadictum](https://cribbnicolas.github.io/deltadictum/),
  built by GitHub Pages from `docs/`: a landing page, [Getting started](docs/getting-started.md) (install,
  opt in, first memory, review, sharing) and [Using DD well](docs/using-dd.md) (what to save, triggers that
  fire, checks, the review UI, troubleshooting), beside the reference pages. The package and plugin
  manifests point at it.
- README: the CI badge reads the test workflow, the install block appears once, the review UI features
  are listed.
- Tests: the maintenance test waits longer for the detached process before removing its project (Windows).

## [0.9.0] - 2026-10-14

The first release. DD keeps project knowledge an agent cannot derive from the code and delivers each piece
at the action it applies to: memories fire by rules (their triggers), so DD costs about what the agent
costs alone.

- **Memories**: one file per memory in `.dd/memories/` (schema 8), with kinds `trap`, `decision`,
  `failed_approach`, `procedure` and `fact`, triggers, an optional check and a required
  `not_derivable`. No MCP server, no resident process, no embedding model, no dependencies.
- **Delivery** by triggers (paths, symbols, commands, prompt keywords, `{a,b}` alternatives) compiled into
  an index, once per session and subagent, re-armed after a compaction. A shell command that only reads or
  searches (`cat`, `sed -n`, `head`, `rg`…) is a read or search event.
- **Checks**: rules over changed files or commands, reported only when the change introduced the violation.
- **Capture** from the session's footprint: at the end of a turn with a failure followed by a fix, or a user
  correction, DD asks the agent to save what it learned; proposals arrive through `.dd/inbox/` and are
  answered in the same turn. Auto-accept activates a proposal whose evidence DD verified itself; anything
  else waits for a person.
- **Opt-in** with the project's `.dd/` folder (a committed `.dd/config.json`, or a first memory):
  `deltadictum init` writes it and compiles; the Codex installer writes it when there is none.
- **Commands**: `/dd:save`, `/dd:recall`, `/dd:review`; `deltadictum init`, `doctor`, `health`,
  `recall`, `status`, `compile`, `maintain`, `ui` and `import` (the project's `.claude/rules/` and
  `.cursor/rules/` files that name paths become memories, with the file as hashed evidence).
- **Daily maintenance**: roll-up, pruning, retirement of memories that never fire despite opportunity.
- **Review UI** (`deltadictum ui`): queues, evidence, breadth, use by trigger dimension, a dry run of
  triggers over recent sessions, batches accepted or rejected whole, re-verification of stale evidence, a
  dashboard, settings (auto-accept and the delivery cap), and every edit and status change.
- **Harnesses**: Claude Code in full; Codex delivery through shell reads and `apply_patch`, OpenCode
  delivery with the tool result, and Grok Build with Claude Code's hooks, none yet verified live.
