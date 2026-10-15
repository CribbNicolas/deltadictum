# DD v2 agent trial: Opus 5.5 and Haiku 5.5 at high effort (2026-10-14)

Code: `src/eval/agent/` (`run.js --taskset=v2`, `tasks-v2.js`, `trial-memories.js`, `judge.js`, `audit.js`,
`report.js`). The tables below come from `report.js`; nothing in them is edited by hand. The reports, the
judge's verdicts with the blind audit's overrides, and the audit verdicts are in [`data/`](data/)
(`trial-v2-<model>.report.json`, `.judge.json`, `.audit-verdicts.jsonl`). The per-run rows, the streams
with their hook events and the diffs stay on the owner's machine: they name local paths.

## What was measured

Ten tasks on the v2 codebase (branch `eval/v2-trial`, `v2` at accd5b4 plus the trial store), each run by
Claude Code headless (`claude -p --effort high`, project settings only) in a fresh clone, under four
conditions, with two models:

| Condition | Knowledge channel |
|---|---|
| `dd2` | DD v2 hooks from this checkout, the trial store compiled; nothing at session start |
| `docref` | the same thirteen memories rendered as `docs/engineering-guide.md`, named in CLAUDE.md |
| `doc` | the same guide, nothing points to it |
| `none` | no `.dd/`, no guide |

Per run: the task's own check (acceptance), the full suite and lint on the changed tree (resolution), the
task's requirements decided by checks where a check can decide and by a blind judge otherwise, plus the
general ones (tested, scoped, conventions); peak context, session time and cost as Claude Code reports
them; and for `dd2`, from the hook events, whether the key memory was delivered, applied or ignored, and
how many other memories were delivered.

## Validity

- The thirteen memories were written before the tasks, from knowledge of this codebase that a capable
  agent does not derive from the code and that no test enforces; seven bear on one task each, six on
  none. They were not edited once the tasks existed (`src/eval/agent/trial-memories.js`, commit accd5b4).
- The guide carries the same text as the memories (`guideSectionV2`), so the documentation conditions
  differ from DD only in the channel.
- The judge (Claude Opus 5.5, no tools, empty directory) sees the task, the guidance, the requirements,
  the diff and the developer's report with DD's and the guide's names redacted; never the condition.
- Every judgment was audited blind by the owner's agent from a numbered package with the condition
  redacted (`audit.js`); overrides are recorded beside the judge's verdicts in `*.judge.json`.
- `--check-only` proved every check fails on an untouched clone before any agent ran.
- Smoke first (2 tasks × 4 conditions × 2 models), then the full run; the smoke's 16 runs are part of
  the results (same code, base and day).

## The store (13 memories)

| Topic | Kind | Bears on |
|---|---|---|
| testing/sqlite-handle-before-rm | trap | maintain-fires-test |
| testing/npm-test-scripts | procedure | test-capture-script |
| engine/compiled-index-version | procedure | clause-kind |
| telemetry/append-whole-lines | trap | stop-asks-telemetry |
| store/writes-go-through-commit | procedure | cli-archive |
| capture/footprint-order-by-time | trap | turn-fixed-test |
| storage/derived-files-under-local | decision | maintenance-log |
| tooling/bash-tool-backslashes | trap | none |
| hooks/codex-payload-shapes | fact | none |
| integrations/opencode/bun-runtime | fact | none |
| hooks/hot-path-commonjs | decision | none |
| engine/symbol-check-excludes-dd | trap | none |
| tooling/no-dependencies | decision | none |

## The tasks

| Task | Kind | What the check decides |
|---|---|---|
| maintain-fires-test | memory | a new maintenance test passes three times and queries `fires`; the handle is closed (judge: before removal) |
| cli-archive | memory | `deltadictum archive <id>` archives; manifest rewritten through commit; index recompiled; reason kept |
| clause-kind | memory | clauses carry `k`; the matcher ranks by it without `runtime.memories`; INDEX_VERSION bumped |
| stop-asks-telemetry | memory | `asks.jsonl` written as whole lines; `asks` table; two roll-ups count one |
| test-capture-script | memory | `npm run test:capture` runs; isolate import; concurrency 1; quoted glob; documented |
| turn-fixed-test | memory | a new turn-checks test passes three times (judge: timestamps consistent) |
| maintenance-log | memory | a log under `.dd/local` (or ignored); root `.gitignore` untouched; whole lines; `status.last_maintenance` |
| keyword-ies-plural | control | memory/memories and query/queries match; store/stores still; party is not part |
| recall-json | control | `recall --json` prints the array with the memory |
| ui-kind-filter | control | `?kind=` filters; unknown kind is 400 `unknown_kind` |

## Results: Claude Opus 5.5, effort high

40 runs (10 tasks × 4 conditions, one repetition), no errors or timeouts. Judge: Claude Opus 5.5, $1.77
for the 40 verdicts (four timed out at first and were judged again with `--resume`); audit: 40/40 read
blind, 39 agreed, 1 override (a one-line docs row the judge accepted in one run of a task and refused in
another: made consistent, `4a433625`). Report:

| | With DD v2 | Guide, referenced in CLAUDE.md | Guide, not referenced | No project knowledge |
|---|---|---|---|---|
| Resolution | 100% (72-100) | 100% (72-100) | 100% (72-100) | 100% (72-100) |
| Resolution, tasks the knowledge bears on | 100% (65-100) | 100% (65-100) | 100% (65-100) | 100% (65-100) |
| Code quality | 100% (100-100) | 98% (94-100) | 100% (100-100) | 96% (91-100) |
| Project requirements met | 100% (100-100) | 100% (100-100) | 100% (100-100) | 100% (100-100) |
| Context (0 = least) | +0% (35.9k) | +3% (37.1k) | +3% (37.1k) | +1% (36.2k) |
| Time (0 = fastest) | +1% (1.22 min) | +2% (1.23 min) | +0% (1.21 min) | +9% (1.32 min) |
| Cost (0 = cheapest) | +0% ($0.4008) | +11% ($0.4467) | +11% ($0.4463) | +7% ($0.4299) |

DD v2 memory use on the seven tasks the knowledge bears on: key memory delivered 7/7, applied 7/7,
ignored 0; median 3 memories delivered per run, 2 of them bearing on no task (702 tokens injected,
median); hook 47 ms against 39 ms for a bare Node start.

Per task (cost, session minutes, quality, guide reads):

| Task | dd2 | docref | doc | none |
|---|---|---|---|---|
| maintain-fires-test | $0.26 0.6m q100 | $0.25 0.5m q100 g0 | $0.31 0.6m q100 g0 | $0.29 0.7m q100 |
| keyword-ies-plural (control) | $0.32 2.5m q100 | $0.37 1.5m q100 g1 | $0.39 3.1m q100 g0 | $0.31 1.4m q100 |
| cli-archive | $0.65 2.4m q100 | $0.92 2.9m q100 g1 | $0.82 2.8m q100 g0 | $0.66 2.6m q100 |
| clause-kind | $0.73 3.1m q100 | $0.56 1.4m q100 g1 | $0.62 1.8m q100 g1 | $0.65 1.8m q75 |
| stop-asks-telemetry | $0.49 2.0m q100 | $0.65 2.0m q100 g1 | $0.50 2.0m q100 g0 | $0.63 2.5m q100 |
| test-capture-script | $0.18 0.8m q100 | $0.16 0.7m q100 g0 | $0.15 0.7m q100 g0 | $0.17 1.3m q86 |
| turn-fixed-test | $0.22 0.4m q100 | $0.22 0.4m q100 g0 | $0.21 0.4m q100 g0 | $0.21 0.4m q100 |
| maintenance-log | $0.56 3.4m q100 | $0.74 3.0m q80 g1 | $0.90 3.1m q100 g1 | $0.78 2.3m q100 |
| recall-json (control) | $0.30 1.2m q100 | $0.28 1.3m q100 g1 | $0.27 1.2m q100 g1 | $0.28 1.2m q100 |
| ui-kind-filter (control) | $0.31 1.2m q100 | $0.32 1.2m q100 g0 | $0.29 1.3m q100 g0 | $0.31 1.2m q100 |

What the numbers say, and what they do not:

- **Opus at high effort met every project requirement in every condition.** The seven memories encode
  knowledge the code does not state, but Opus reached each rule on its own: it reads the sibling tests
  (closing the handle, the three parts of a test script), the version comments in `index-file.cjs`,
  the existing `appendTelemetry` and offset keys, and `archiveMemory` in the review actions. With this
  model on this codebase, the knowledge turned out derivable in practice, by reading, not by the code
  stating it. The requirements the memories carry were still right: every run honoured them.
- **The quality gaps are mechanical slips, not knowledge gaps:** three runs dropped a space or broke a
  column while editing (`test:stress` line, the `health` help line, `dims:DIMENSIONS`), and two of them
  were in `none`, one in `docref`. None in `dd2`, which with n=10 is not a signal.
- **Cost and context:** DD v2 was the cheapest and lowest-context condition, as in the 2026-10 trial;
  per task the differences are noise (dd2 cheaper than none in 5 of 10 tasks, mean −$0.03). The guides
  cost 11% more than DD and were read in 6 of 10 runs when CLAUDE.md names them, 3 of 10 when it does
  not: a reference in CLAUDE.md doubles the reads and still misses 4 of 10.
- **Delivery worked as designed, with one limit visible:** the key memory arrived in every memory task;
  in five of the seven before the first edit, through the read of a sibling test or of the module to
  change, and in two (maintain-fires-test, maintenance-log) on the pre-tool event of the first edit
  itself, whose path is the trigger. A memory that fires on the file being written reaches the agent
  after it decided that write: in maintenance-log the first edit already kept the file under
  `.dd/local`, in maintain-fires-test the close before the removal came in the next edit. The two
  other memories delivered per run are the prompt-keyword and broad-path clauses (the telemetry trap on
  the word "telemetry", the hot-path decision on any `src/engine/*.cjs` edit), the hub shape the health
  report now makes visible.

## Results: Claude Haiku 5.5, effort high

40 runs (10 tasks × 4 conditions, one repetition), no errors or timeouts. Judge: Claude Opus 5.5, $1.78
for the 40 verdicts (four timed out at first and were judged again with `--resume`); audit: 40/40 read
blind, 40 agreed, 0 overrides. Report:

| | With DD v2 | Guide, referenced in CLAUDE.md | Guide, not referenced | No project knowledge |
|---|---|---|---|---|
| Resolution | 100% (72-100) | 100% (72-100) | 100% (72-100) | 100% (72-100) |
| Resolution, tasks the knowledge bears on | 100% (65-100) | 100% (65-100) | 100% (65-100) | 100% (65-100) |
| Code quality | 100% (100-100) | 100% (100-100) | 100% (100-100) | 100% (100-100) |
| Project requirements met | 100% (100-100) | 100% (100-100) | 100% (100-100) | 100% (100-100) |
| Context (0 = least) | +2% (46.2k) | +3% (46.6k) | +0% (45.1k) | +1% (45.6k) |
| Time (0 = fastest) | +22% (1.57 min) | +0% (1.29 min) | +22% (1.57 min) | +0% (1.29 min) |
| Cost (0 = cheapest) | +0% ($0.0198) | +3% ($0.0203) | +4% ($0.0206) | +8% ($0.0213) |

DD v2 memory use on the seven tasks the knowledge bears on: key memory delivered 6/7, applied 6/6,
ignored 0; median 3 memories delivered per run, 2 of them bearing on no task (703 tokens injected,
median); hook 53 ms against 45 ms for a bare Node start. Four of the six arrived before the first edit,
two (maintain-fires-test, maintenance-log) on the pre-tool event of the first edit itself, as with
Opus; in both that edit already honoured the rule.

Per task (cost, session minutes, quality, guide reads):

| Task | dd2 | docref | doc | none |
|---|---|---|---|---|
| maintain-fires-test | $0.011 0.6m q100 | $0.011 0.5m q100 g0 | $0.011 0.6m q100 g0 | $0.011 0.6m q100 |
| cli-archive | $0.042 3.3m q100 | $0.028 2.0m q100 g1 | $0.027 2.1m q100 g0 | $0.038 2.6m q100 |
| clause-kind | $0.024 2.7m q100 | $0.028 2.0m q100 g1 | $0.026 1.9m q100 g0 | $0.043 2.8m q100 |
| stop-asks-telemetry | $0.027 2.7m q100 | $0.036 2.4m q100 g1 | $0.028 1.8m q100 g0 | $0.038 2.5m q100 |
| test-capture-script | $0.006 0.5m q100 | $0.006 0.4m q100 g0 | $0.007 0.5m q100 g0 | $0.005 0.4m q100 |
| turn-fixed-test | $0.012 0.6m q100 | $0.009 0.4m q100 g0 | $0.010 0.6m q100 g0 | $0.012 0.7m q100 |
| maintenance-log | $0.038 3.0m q100 | $0.045 3.8m q100 g1 | $0.039 3.2m q100 g0 | $0.025 2.4m q100 |
| keyword-ies-plural (control) | $0.012 1.6m q100 | $0.013 1.3m q100 g1 | $0.034 2.4m q100 g0 | $0.014 1.3m q100 |
| recall-json (control) | $0.014 1.9m q100 | $0.014 2.0m q100 g1 | $0.012 1.3m q100 g0 | $0.014 1.1m q100 |
| ui-kind-filter (control) | $0.013 1.1m q100 | $0.015 1.3m q100 g1 | $0.012 1.6m q100 g0 | $0.013 1.6m q100 |

What the numbers say, and what they do not:

- **Haiku at high effort met every project requirement in every condition too**, at a twentieth of
  Opus's cost per run ($0.02 against $0.40) and without a single quality slip. Like Opus it reached each
  rule by reading the neighbouring tests and modules: closing the handle before the folder goes, fixing
  the Stop's `now`, the whole-line append, the version bump, the commit through the store, all done in
  every condition.
- **Time is the one measure where DD v2 does not lead**, +22% at the median, and the same +22% shows
  in `doc`, which has no hooks. By task kind: memory tasks 2.65 min in dd2 against 1.95, 1.80 and 2.33,
  controls 1.57 against 1.29, 1.57 and 1.29. The dd2 runs made fewer tool calls (median 19 against 22 to
  30 on the memory tasks) but longer ones: 30 test commands against 24 to 27, and three runs of
  `npm run bench:v2`, which only a dd2 clone can run (17 s on an idle machine; elsewhere it exits at
  once, see the caveats). The hook itself costs 53 ms per tool call against 45 ms for a bare Node
  start: about a second per run. With ten runs per cell, 0.3 min at the median is noise.
- **Cost and context:** DD v2 was again the cheapest condition (none +8%), within 3% of the least
  context. Without the two matching tasks, where the agents without a store spent turns on the bench
  they could not run, the totals over the other eight tasks are dd2 $0.161, docref $0.162, doc $0.146,
  none $0.156: a tie. For Opus the same cut keeps dd2 cheapest ($2.96 against $3.34 to $3.54).
- **Guide reads:** 7 of 10 when CLAUDE.md names the guide, 0 of 10 when nothing does. Haiku never
  opened a document nothing pointed at.
- **The one missed delivery** (turn-fixed-test, dd2): Haiku read `src/capture/footprint.js` and
  `turn.js` with `cat` through Bash, which the Claude Code adapter of the trial recorded as a run, not a
  read (only the Codex adapter classified shell reads then), and its edit called the test file's
  `edited()` helper rather than `appendFootprint` or `footprintPath`, so neither the path nor the symbol
  clause of the memory fired; two memories fired on the prompt's words ("telemetry", ".dd/local")
  instead. The test it wrote fixed the Stop's `now` anyway (judge and audit: timestamps consistent).

## Caveats found after the runs

- **The allow list refused compound commands.** The runs pass `--allowedTools` with an allow list; a
  command whose parts fall outside it (a redirection into a log file, a pipe into `grep`, `npx eslint`,
  a Python heredoc) is refused and the agent retries. Counted in the streams: Opus 14 refusals in 12
  runs, Haiku 23 in 14 runs, spread over the four conditions (Opus 3, 4, 4, 3; Haiku 4, 5, 3, 11).
  Every run but one got a test command through; the exception (Opus, clause-kind, docref) delivered
  without running anything and said so, and the runner's own check, suite and lint still passed it.
  The retries cost time and tokens in every condition alike. The list has since been widened to the
  shell commands that inspect a tree and to `npx` (`src/eval/agent/permissions.js`); a next trial
  measures whether the refusals go.
- **Only the dd2 clone has a store.** CLAUDE.md asks for `npm run bench:v2` on matching changes and the
  bench needs `.dd/`: in dd2 it ran (Opus 5 runs, Haiku 3), elsewhere it exited with `bench_no_memories`,
  and in a few runs the agent spent turns trying to rebuild the store (a tar extraction the sandbox
  refused, scratch materialize scripts). This favours dd2 on cost in the two matching tasks and counts
  against it on time.
- **The telemetry lock test is flaky under load** (`a write waits for another process holding the
  telemetry lock instead of failing`): the first suite run failed on it in 2 Opus and 3 Haiku runs and
  passed on the rerun; the rows keep both outcomes (`suite_first_passed`, `suite_flaky_tests`).
- **The results file named the wrong model** (`claude-sonnet-5-5`, no effort) after `--recheck` rewrote
  its header without `--model`; the rows always carried the real model and effort. `run.js` now takes
  the header from the rows, both files were repaired, and the reports did not change.

## What the two models say together

- **A ceiling, not a null result.** Both models at high effort met 100% of the project requirements in
  all four conditions. On this codebase the seven rules the memories carry can be reached by reading
  (sibling tests, version comments, existing helpers), so this task set cannot show a quality effect
  of any knowledge channel. The 2026-10 trial on the v1 code, where the rules were not on the reading
  path, measured +7 quality points for DD; this one measures what DD v2 costs when it is not needed.
- **What it does establish:** DD v2 costs no more than the agent alone (the cheapest condition for both
  models; a tie for Haiku once the matching tasks are set aside), uses the least or near-least context,
  delivered the key memory in 13 of 14 runs (before the first edit in 9, with the first edit in 4, where
  the edit itself was the trigger and in 3 of the 4 already honoured the rule), every delivered key
  memory was honoured, at about 700 tokens of other memories per run and about a second of hook time.
  Against a referenced guide, v1's +24 to 31% cost (2026-10) is now −10% (Opus) and −2% (Haiku).
- **Documents depend on being read; delivery does not.** A guide named in CLAUDE.md was read in 6 of 10
  (Opus) and 7 of 10 (Haiku) runs; the same guide unreferenced in 3 of 10 and 0 of 10.
- **Noise has one source:** the two memories per run that bear on no task fire on prompt keywords (the
  single words "telemetry" and ".dd/local") and on the broad `src/engine/*.cjs` path; the health report
  now shows fires by dimension, which is what a curation pass needs.
- **Next:** a trial on a project whose knowledge is not derivable by reading (environment facts,
  abandoned approaches: the kinds this task set did not exercise).

Cost of the trial: Opus runs $17.24, Haiku runs $0.82, judges $3.55.

## Follow-up (2026-10-15, before 0.9.0)

- A shell command that only reads or searches (`cat`, `sed -n`, `head`, `rg`…) is a read or search event
  in Claude Code too: the one missed delivery above would have fired on the `cat` of `footprint.js`.
- The trial's allow list covers the shell commands that inspect a tree and `npx`
  (`src/eval/agent/permissions.js`); whether the refusals go is measured at the next run.
- This repository's own store was curated: of 47 live memories, 25 that described v1 mechanisms are
  archived and the 22 that remain carry phrases instead of single generic prompt keywords (the "telemetry"
  and ".dd/local" noise above came from that shape), live globs, `not_derivable` and fresh evidence.
- Still open: a trial on a project whose knowledge is not derivable by reading.

## Reproduce

```bash
node src/eval/agent/run.js --taskset=v2 --check-only --conditions=dd2,docref,doc,none --out=check.json --runs=check-runs
node src/eval/agent/run.js --taskset=v2 --model=claude-opus-5-5 --effort=high --repeat=1 --conditions=dd2,docref,doc,none --out=trial-v2-opus.json --runs=trial-v2-runs-opus --conc=2
node src/eval/agent/run.js --taskset=v2 --model=claude-haiku-5-5 --effort=high --repeat=1 --conditions=dd2,docref,doc,none --out=trial-v2-haiku.json --runs=trial-v2-runs-haiku --conc=2
node src/eval/agent/judge.js --in=trial-v2-opus.json --conditions=dd2,docref,doc,none --conc=2
node src/eval/agent/audit.js --in=trial-v2-opus.json            # then the blind audit, then --apply=<verdicts>.jsonl
node src/eval/agent/report.js --in=trial-v2-opus.json --conditions=dd2,docref,doc,none
# the same three steps for trial-v2-haiku.json; judge.js --resume retries verdicts that timed out
```
