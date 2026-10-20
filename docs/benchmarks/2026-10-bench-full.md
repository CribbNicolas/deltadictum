---
title: Full benchmark, four projects (2026-10-18)
description: "DeltaDictum's full agent benchmark: four projects, twenty situations, 26 pre-registered tasks, Claude Opus 5.5 and Claude Haiku 5.5, with every table, the harness faults found and their caveats."
parent: Benchmarks
nav_order: 1
---

# Full benchmark: four projects, Opus 5.5 and Haiku 5.5 at high effort (2026-10-18)

Code: `src/eval/bench/` (`run.js`, `calibrate.js`, `report.js`, `totals.js`, the projects under
`projects/`) with the judge and audit of `src/eval/agent/` (`judge.js`, `audit.js`). The tables below come
from `report.js`; nothing in them is edited by hand. In [`data/`](data/): the pre-registered selection
(`bench-2026-10-calibration.json`), per model the report, the judge's verdicts with the audit's overrides
and the audit verdicts (`bench-2026-10-<model>.report.json`, `.judge.json`, `.audit-verdicts.jsonl`), the
site summaries (`.summary.json`) and the totals across both models (`bench-2026-10-totals.json`). The
per-run rows, the streams with their hook events and the diffs stay on the owner's machine: they name local
paths.

## What was measured

Each run is Claude Code headless (`claude -p --effort high`, project settings only) in a fresh clone of one
of four projects, under four conditions:

| Condition | Knowledge channel |
|---|---|
| `dd2` | DD v2 hooks from this checkout, the project's store compiled |
| `docref` | the same memories rendered as `docs/engineering-guide.md`, named in the project's CLAUDE.md |
| `doc` | the same guide, nothing points to it |
| `none` | no `.dd/`, no guide |

| Project | Stack | Store | Tasks |
|---|---|---|---|
| tollgate | Go, invented | 16 memories written for it | invented |
| ledgerkit | Python, invented | 17 memories written for it | invented |
| supermem (DD itself) | Node | 28 memories | mined from v2 fixes, each starting at the fix's parent |
| Patriark | C# / .NET 8, a real project | its own 87-memory store | authored on its history |

The candidates cover twenty situations (S1–S20: a trap in the code path, a decision the code does not
show, a review, a request that contradicts a memory, controls where no memory applies, and so on). Per
run: the task's own check, the project's suite and lint on the changed tree (resolution); the task's
project requirements, decided by checks; tested, scoped and conventions, decided by a blind judge; peak
context, session time and cost as Claude Code reports them; and for `dd2`, from the hook events, when the
key memories arrived and what else came with them.

## Validity

- **Pre-registration.** 72 candidate tasks ran three times each with Haiku in `none` (216 runs). A memory
  task was kept when the agent alone failed it at least once; controls were always kept; at most four per
  situation. 26 were selected (15 memory tasks, 11 controls) and committed before any full run
  (`bench-2026-10-calibration.json`, commit e21b16f). The rule: no task, check or memory changes after that
  commit except a harness fault, recorded in its commit.
- **Proof per task.** Every check fails on an untouched clone, passes the correct overlay, and (memory
  tasks with one) catches the naive overlay, which does what was asked and breaks the memory
  (`tests/bench/`). Mined and ported tasks have no naive overlay: the fix's own test decides them.
- **The guide is the store.** The documentation conditions carry the same memories as DD, so they differ
  from `dd2` only in the channel.
- **The store in git history.** In these runs a clone's history still held `.dd/`: 20 of the 340 commits up
  to supermem's bases touched it, and 5 of the 39 up to Patriark's. An agent without DD could have read
  the memories with `git log -p`. None of the 595 git commands in the runs without DD showed one. Later
  runs start from a history rewritten without the store and without the commits that touched only the
  store (`src/eval/bench/history.js`). All four conditions get the same commits, and `--check-only` fails a
  clone whose history names `.dd/`.
- **Blind judge.** Claude Opus 5.5, no tools, an empty directory; it sees the task, the guidance, the
  requirements, the diff and the developer's report with DD's and the guide's names redacted, never the
  condition. All 624 runs were judged.
- **Blind audit.** Every verdict was re-read from a hashed packet with the condition redacted
  (`audit.js`), by twelve auditing agents (Claude Sonnet 5.5) and the owner's agent: 11 overrides for Haiku,
  17 for Opus, each with its reason in the audit verdicts.
- **Billing.** Every agent and judge ran on the owner's subscription; the runner refuses to start with an
  API key in the environment. A usage limit is waited out and the run repeated, never recorded: two
  session limits were waited out (2 h 44 min in the Opus run, 2 h 8 min in the judge).

## Harness faults found and fixed

Every row was read against its diff before any number was taken. Each fault below made a check fail
work that was correct. Each fix was shown to fail the recorded diffs before and pass them after, the task's
proof was run again, and the recorded diffs were checked again (`run.js --recheck`, the original verdict
kept on the row under `rechecked`). Unit tests pin the suite rules, the review matcher (with reviews that
must not count), the replay client rule and the skills check; the other fixes rest on the recorded diffs
and the proofs. A final review of the fixes found two of them too lenient (the review matcher credited
reviews that clear the registration, the replay rule credited a partner line the change rewrites); both
were tightened, with no verdict changing on the recorded runs.

Before selection (from the calibration):

- `tollgate-network-retry`: Haiku read the prompt as an instruction for its own session, 3/3 one-turn
  runs with no change; the prompt now names the bug.
- `supermem-glob-star-chain`: three correct fixes dropped the `globToRegExp` export and the hidden test
  crashed on import; it now goes through the matcher and the compiled index the hook uses.
- `supermem-skills-npx`: three correct skills wrote "Do not run `npx deltadictum`" and the check counted
  it as running npx.
- `supermem-compile-overlap` was dropped: a lock, a rebuild of a bodiless index and unclaimed bodiless
  deliveries are all defensible fixes, and its test accepted only the upstream design.

After the pre-registration (from the smoke and the full runs):

- The suite verdict failed a run when its two suite runs failed different tests (no test failed twice).
- `supermem`: one maintenance test failed under load in a run that touched only the UI, and passed 5/5 on
  that change: known flaky.
- `tollgate-dedup-evict`: two Opus `dd2` runs gave `NewDedup` a logger (passing `nil` in their own
  tests); the hidden test called `NewDedup()` and did not build.
- `patriark-short-hash`: three Haiku runs wrote an instance `ShortHash`, like the instance `StateHash`
  beside it; the hidden test called it static.
- `tollgate-replay-to`: the idle-timeout requirement read one file while most runs built the client
  where the subcommand is wired; and the hidden test set no signing secret, failing five Haiku runs that
  signed every replay, as the project's rule says, and refused to send one unsigned.
- `patriark-review-command`: the review matcher missed "isn't registered", "didn't add", "has no
  `[JsonSerializable]`" and other wordings; all 24 reviews name the finding.

Two selected tasks entered the selection only through these faults: with the fixed checks the calibration
has no failure on `tollgate-replay-to` or `patriark-review-command`. They stay in the pre-registered set and
are near the ceiling in every condition.

## Results: Claude Opus 5.5, effort high

26 tasks × 4 conditions × 3 runs = 312 runs, no harness error, no timeout. Resolution = check passed,
suite and lint clean. Context, time and cost: medians and mean, 0 = the lowest condition.

| | With DD v2 | Guide, referenced | Guide, not referenced | No project knowledge |
|---|---|---|---|---|
| Resolution | 100% (95-100) | 100% (95-100) | 99% (93-100) | 95% (88-98) |
| Code quality | 97% (95-99) | 97% (95-99) | 98% (95-100) | 92% (89-95) |
| Project requirements met | 100% (100-100) | 100% (100-100) | 98% (93-100) | 69% (56-82) |
| Context (0 = least) | +5% (39.7k) | +9% (41.3k) | +7% (40.4k) | +0% (37.8k) |
| Time (0 = fastest) | +7% (1.45 min) | +0% (1.35 min) | +4% (1.41 min) | +1% (1.36 min) |
| Cost (0 = cheapest) | +6% ($0.4551) | +17% ($0.5007) | +11% ($0.4742) | +0% ($0.428) |

Project requirements are over the 15 memory tasks; the other rows over all 26.

- **Against the agent alone**, paired by task: DD meets 31 points more of the project's requirements
  (95% interval 13 to 51), and resolves 5 points more (0 to 14). Alone, Opus fails the task or breaks a
  project rule in 15 of 45 memory runs: the store format not bumped (`tollgate-store-attempts`, 3/3), the
  72-hour dedup window evicted (`tollgate-dedup-package` 3/3, `tollgate-dedup-evict` 2/3), a command that
  rewrites a file not counted as an edit (`supermem-run-is-not-edit`, 3/3), overlapping imports doubled
  (`ledgerkit-import-dir`, 2/3), and one run each of two other tasks. With DD: none of 45.
- **Against the referenced guide**, the same knowledge in the other channel: no difference in resolution
  or requirements (both at the ceiling), and DD is cheaper. Paired, $0.046 less per run (0.008 to 0.090)
  and 4.0k tokens less peak context (1.0k to 7.7k): the guide is read whole, DD delivers what fires.
- **Delivery.** The key memory reached the agent in 98% of memory runs, 39 of 44 before the first edit.
  Median four other memories per run; median 773 tokens injected; the hook took a median 47 ms.
- **Controls** (no memory applies): 100% resolved in every condition; DD added a median one memory and
  254 tokens.

## Results: Claude Haiku 5.5, effort high

312 runs, no timeout. One check lost its connection to the review UI server it started (`ECONNRESET`)
and was run again on the recorded change.

| | With DD v2 | Guide, referenced | Guide, not referenced | No project knowledge |
|---|---|---|---|---|
| Resolution | 92% (84-96) | 97% (91-99) | 100% (95-100) | 92% (84-96) |
| Code quality | 94% (91-97) | 97% (95-99) | 97% (95-99) | 85% (81-90) |
| Project requirements met | 96% (89-100) | 98% (93-100) | 100% (100-100) | 43% (30-57) |
| Context (0 = least) | +9% (50.1k) | +19% (54.8k) | +14% (52.6k) | +0% (46.1k) |
| Time (0 = fastest) | +19% (1.54 min) | +18% (1.52 min) | +12% (1.44 min) | +0% (1.29 min) |
| Cost (0 = cheapest) | +30% ($0.0266) | +13% ($0.0231) | +16% ($0.0237) | +0% ($0.0205) |

- **Against the agent alone**, paired by task: DD meets 52 points more of the project's requirements
  (30 to 72). The resolution is the same (92%), for different reasons: alone, Haiku fails memory tasks;
  with DD, it fails the control below.
- **DD made Haiku refuse an explicit request.** In `ledgerkit-summary-print` (S10) the user asks for the
  import summary on stdout with `print()`, which a memory forbids ("stdout carries only report output").
  With DD, Haiku declined the request in 3 of 3 runs, citing the memory; with the referenced guide in 1 of
  3; alone and with the unreferenced guide never. Opus did what was asked in every condition. DD's contract
  is that delivered knowledge never outranks the user; with Haiku, a delivered memory did. It is the
  benchmark's clearest finding against DD.
- **Against the guide**, DD is behind: 5 points less resolution against the referenced guide (−13 to 1)
  and 8 against the unreferenced one (−18 to 0). Of the six `dd2` runs not resolved, three are the refusal
  above, two `supermem-run-is-not-edit` and one review that left scratch files in the repository.
  Requirements are level within their intervals (−2 against the referenced guide, −13 to 7). Alone, Haiku
  fails the task or breaks a rule in 28 of 45 memory runs; with DD in 3.
- **Delivery.** The key memory reached the agent in 96% of memory runs, 36 of 43 before the first edit;
  median three other memories and 602 tokens; the hook took a median 54 ms.
- **Cost.** DD is the most expensive condition with Haiku (+30% against the agent alone, $0.006 per run
  paired), where it is the cheapest knowledge channel with Opus.

## Caveats

- **Selected tasks.** The memory tasks are the ones Haiku alone failed at least once; the gap against the
  agent alone is measured where knowledge matters, by design, and is not an estimate for an average task.
  Ten situations kept a memory task (S1, S2, S4, S5, S6, S8, S13, S14, S15, S18); in S3, S7, S9, S12, S16,
  S17, S19 and S20 Haiku alone solved every candidate. Patriark kept one memory task.
- **Small samples.** 45 memory runs per condition and model; intervals are wide and the guide conditions
  sit at the ceiling, so DD and the guide are not told apart on requirements.
- **Same knowledge, same day.** Every condition carries the same memories; the comparison is the channel,
  not the content. A real project's guide is rarely this complete, nor its store.
- **One judgment area was ruled.** Where the user explicitly asks for stdout (three control tasks), the
  judge and the auditors split on whether printing there breaks the project's stdout rule; the owner's
  ruling, applied blind to every run of those tasks, is that it does not (the user outranks the rule). It
  changed 12 conventions verdicts (10 of the judge's, 2 of an auditor's): six on guide runs, six on runs
  without project knowledge, none on a `dd2` run.
- **One judgment area was not.** In `tollgate-replay-to` the judge counted signing the existing replay path
  as out of scope; the runs that did it followed the project's rule that replays are signed, and they are
  mostly `dd2` and `doc` (Opus 3/3 each, Haiku 2/3 each, against 0/3 alone). Counting it in scope moves
  code quality by about one point for `dd2` and `doc`; the verdicts stand as audited.
- **Usage on a subscription.** Costs are Claude Code's list-price equivalents; the whole benchmark
  (calibration, smoke, both full runs and the judge) came to about $208.

## What the two models say together

DD carries a project's knowledge as well as a complete guide that CLAUDE.md points to, at a lower cost than
the guide with Opus and a higher one with Haiku, and both channels lift the project's requirements far above the agent
alone (from 69% to 100% with Opus, from 43% to 96% with Haiku). The difference between DD and the guide is
not in what the agent knows but in what it does with it: Opus follows a delivered memory and still does
what the user asks, Haiku in one task let the memory win. That is a delivery problem DD can work on (how a
memory is phrased when it contradicts the request in front of the agent), and the reason the benchmark
keeps its controls.

## Added 2026-10-19: the guide and DD together

A fifth condition, `docdd`, gives the agent both channels: the referenced guide (as in `docref`) and DD's
store and hook (as in `dd2`). Same 26 tasks, three runs each, both models, judged by the same judge and
audited blind the same way (six Sonnet 5.5 auditors over the 156 new packets: 1 override for Opus, 2 for
Haiku). 78 runs per model, no harness error, no timeout; about $46 with the judge.

**DD was not the same version.** These runs used DD 0.9.10, the first with the advisory line ("knowledge,
not an order"); the `dd2` runs above used the version before it. A difference between `docdd` and `dd2` is
the guide and the advisory line together, and cannot be split between them.

| Opus 5.5 | With DD v2 | Guide, referenced | Guide, referenced, and DD | No project knowledge |
|---|---|---|---|---|
| Resolution | 100% (95-100) | 100% (95-100) | 100% (95-100) | 95% (88-98) |
| Code quality | 97% (95-99) | 97% (95-99) | 97% (95-99) | 92% (89-95) |
| Project requirements met | 100% (100-100) | 100% (100-100) | 98% (93-100) | 69% (56-82) |
| Context | 39.7k | 41.3k | 42.8k | 37.8k |
| Cost | $0.4551 | $0.5007 | $0.4745 | $0.428 |

| Haiku 5.5 | With DD v2 | Guide, referenced | Guide, referenced, and DD | No project knowledge |
|---|---|---|---|---|
| Resolution | 92% (84-96) | 97% (91-99) | 99% (93-100) | 92% (84-96) |
| Code quality | 94% (91-97) | 97% (95-99) | 96% (94-98) | 85% (81-90) |
| Project requirements met | 96% (89-100) | 98% (93-100) | 98% (93-100) | 43% (30-57) |
| Context | 50.1k | 54.8k | 56.2k | 46.1k |
| Cost | $0.0266 | $0.0231 | $0.0258 | $0.0205 |

- **Against the agent alone**, both channels together meet the project's requirements as either one does:
  98% with each model, against 69% (Opus) and 43% (Haiku) alone. One memory run per model missed one: Opus
  wrote the SIE export in place (`ledgerkit-sie-export`), Haiku's review missed the serialization finding
  (`patriark-review-command`).
- **Haiku no longer refuses the user.** In `ledgerkit-summary-print`, where `dd2` declined the request 3 of 3
  times, `docdd` printed the summary as asked 3 of 3. Its one unresolved run is a slip of another kind:
  Haiku answered that the message held no request (`ledgerkit-malformed-row-docdd-0`), a reply no other run
  of the benchmark gave.
- **Over-applied knowledge.** Haiku's quality loss is mostly scope: 10 of 78 runs went beyond the task, 8 of
  them by adding duplicate skipping to ledgerkit changes that did not ask for it, applying the
  overlapping-exports memory where it does not bear. With one channel Haiku did so less: 4 runs with `dd2`,
  5 with the referenced guide, none with the unreferenced one, 1 alone.
- **Cost of carrying both.** The guide is read whole (in 94% of runs, with either model) and DD delivers on top of it, so
  context is the highest of any condition: paired with `dd2`, 2.7k tokens more with Opus (0.8k to 4.7k) and
  4.6k with Haiku (0.7k to 8.1k). Cost sits between DD alone and the guide alone with Opus, and near DD's
  with Haiku.
- **Delivery** is unchanged: the key memory reached the agent in 98% (Opus) and 96% (Haiku) of memory runs,
  as in `dd2`. The hook's median time (64 ms Opus, 66 ms Haiku) is not comparable with `dd2`'s: both models
  ran at once, six sessions on one machine.

```bash
node src/eval/bench/run.js --model=claude-opus-5-5 --effort=high --selection=docs/benchmarks/data/bench-2026-10-calibration.json \
  --conditions=docdd --repeat=3 --conc=3 --resume --out=bench-2026-10/opus/results.json
node src/eval/agent/judge.js --in=bench-2026-10/opus/results.json --model=claude-opus-5-5 --conditions=docdd --resume
# judge.js rewrites the judge file: rebuild the audit packets and apply every verdict, old and new, again
node src/eval/agent/audit.js --in=bench-2026-10/opus/results.json --apply=<all verdicts>.jsonl
```

## Layer 1: the runs' tool calls replayed, with no model

Layer 1 replays every run's recorded tool calls through DD's matcher, as the hook's events and with each
project's bench memories. It measures delivery alone, and it is free. The fixtures are in
`src/eval/bench/layer1/fixtures/`, one per invented project and supermem (552 runs, about 470 KB gzipped),
each with its expected summary beside it. Patriark's 72 runs are replayed from a fixture that stays local.
Paths are repository-relative, a path outside the clone is dropped, and text names the clone `.`, a home
folder `~` and another bench folder `<tmp>`. A test in `npm test` replays each fixture through the production
engine and the reference engine. It fails if the two disagree, or if a summary moves. A change to triggers
or to the engine therefore shows its effect on delivery as a diff of `*.expected.json`.

Each run is also replayed under three mutations: `no-prompt` drops the prompt, so delivery has to come from
the files the agent touches; `reads-shuffled` permutes the reads and searches before the first edit;
`sibling-paths` renames every file to a sibling in the same folder, `dir/zz-sibling-name.ext`. A key memory
counts as delivered when every key memory of its task arrives. The table shows the dd2 runs' traces:

| Project | runs | as recorded | no prompt | reads shuffled | sibling paths |
|---|---|---|---|---|---|
| ledgerkit | 66 (48 with a key) | 94%, 81% before the first edit | 94%, 63% | 94%, 81% | 65%, 65% (6 runs got one key of two) |
| supermem | 30 (12) | 100%, 83% | 100%, 83% | 100%, 83% | 25%, 17% |
| tollgate | 42 (24) | 100%, 92% | 100%, 92% | 100%, 92% | 100%, 50% |
| patriark | 18 (6) | 100%, 100% | 100%, 100% | 100%, 100% | 83%, 83% |

- The replay agrees with what the hook delivered in the real dd2 runs on 95 of 96 key memories. The 96th
  (Opus, `ledgerkit-review-fix-entries-dd2-2`) did not get the memory from the hook: the agent printed the
  store itself. The replay's three misses (that run, the same task with Haiku, and Haiku's
  `ledgerkit-sie-export-dd2-0`) are traces that never touched the memory's paths or words.
- Without the prompt, every key still arrives, but in ledgerkit later: 63% before the first edit instead of
  81%. In those tasks the prompt's words delivered the memory before the agent opened a file.
- Shuffling the reads changes nothing. Delivery is once per session and does not depend on order. The
  mutation guards that.
- `sibling-paths` measures how much delivery rests on the exact files. It is not a recall target: a memory
  scoped to one file should not fire on its neighbour. supermem's memories name files and mostly stop.
  tollgate's are scoped to folders and keywords and all still fire, half of them later.
- Patriark's dd2 runs deliver a median of 22 memories besides the key (87 live memories, many with broad
  paths). The invented projects deliver 1 to 4.

The other conditions' traces, replayed against the same memories, would have delivered 83% to 100% of the
key memories. The exception is supermem's runs without any knowledge, at 67%: some of those agents never
opened the files the memories name. Patriark's fixture names another owner's repository, so it is generated into `output/eval` and
replayed only where that repository exists.

```bash
node src/eval/bench/layer1/extract.js --runs=bench-2026-10/haiku,bench-2026-10/opus   # the fixtures
node src/eval/bench/layer1/run.js                   # tables, output/eval/bench-layer1-report.json
node src/eval/bench/layer1/run.js --write-expected  # after a deliberate change to delivery
```

## Added 2026-10-20: DD 0.9.11, the delivery fixes

Every Haiku run with DD that failed or lost a check was read, and two causes were DD's own:

- **A first prompt read as a correction.** "Do not change any code" in a review task matched the correction
  patterns, so at Stop DD asked the agent to save a correction that never happened. 12 runs in 78 took that
  extra turn in each model and condition with DD; in two of Haiku's the reply ("nothing to save") replaced the review, and
  the run lost its answer. Since 0.9.11 a prompt is read as a correction only once the session has done
  something to correct.
- **A rule the code breaks read as work.** The ledgerkit memory on overlapping exports says an import must
  skip ids already in the ledger, and the code does not. Haiku added duplicate skipping inside unrelated
  tasks. The advisory line that closes every delivery now says that a problem the knowledge shows outside
  the task is reported, not fixed.

`dd2` ran again from the 0.9.11 code on the same 26 tasks, three runs each with both models, judged and
blind-audited the same way (no audit override in either model). The other conditions are the runs above,
unchanged.

| Claude Haiku 5.5 | With DD 0.9.11 | With DD, earlier | Guide, referenced | Guide, not referenced | No project knowledge |
|---|---|---|---|---|---|
| Resolution | 99% (93-100) | 92% (84-96) | 97% (91-99) | 100% (95-100) | 92% (84-96) |
| Code quality | 97% (95-99) | 94% (91-97) | 97% (95-99) | 97% (95-99) | 85% (81-90) |
| Project requirements met | 98% (93-100) | 96% (89-100) | 98% (93-100) | 100% (100-100) | 43% (30-57) |
| Context | 48.5k | 50.1k | 54.8k | 52.6k | 46.1k |
| Cost | $0.0236 | $0.0266 | $0.0231 | $0.0237 | $0.0205 |

Paired by task against the earlier `dd2`, Haiku resolves 6.4 points more (0.0 to 15.4), scores 3.5 points
more on quality (−0.3 to 8.4) and costs $0.0030 less per task (−$0.0050 to −$0.0012). Only the cost
difference clears zero; the resolution difference rests mostly on one task, the refusal of
`ledgerkit-summary-print` (0.9.10's advisory line), now done as asked 3 runs of 3. Checks failed for scope
fell from 11 to 5. Runs that added duplicate skipping fell from 5 to 2, both in `ledgerkit-usd-import`, so
the advisory line reduces that reading without ending it; the other three committed scratch files or
refactored beyond the task. The one unresolved run is a wrong implementation of
`supermem-run-is-not-edit`, which delivery cannot fix.

| Claude Opus 5.5 | With DD 0.9.11 | With DD, earlier | Guide, referenced | Guide, not referenced | No project knowledge |
|---|---|---|---|---|---|
| Resolution | 100% (95-100) | 100% (95-100) | 100% (95-100) | 99% (93-100) | 95% (88-98) |
| Code quality | 98% (96-99) | 97% (95-99) | 97% (95-99) | 98% (95-100) | 92% (89-95) |
| Project requirements met | 100% (100-100) | 100% (100-100) | 100% (100-100) | 98% (93-100) | 69% (56-82) |
| Context | 39.8k | 39.7k | 41.3k | 40.4k | 37.8k |
| Cost | $0.4344 | $0.4551 | $0.5007 | $0.4742 | $0.428 |

Opus kept its answers through the extra turn, so the correction fix shows in cost: paired by task it costs
$0.0207 less per task (−$0.0452 to −$0.0024), 4.5% less, and is now 1% above the agent alone; resolution is
the same and quality 1.1 points higher (−1.0 to 3.6). No run of either model took the false correction turn
(0 of 156, against 24 of 156 before).

The new runs differ from the earlier ones in DD's version only. The earlier `dd2` ran before 0.9.10, so the
new runs carry both versions' changes: 0.9.10's advisory line and 0.9.11's two fixes. Data:
`data/bench-2026-10-fix-{haiku,opus}.{report,judge}.json` and their audit verdicts; each report pairs the
new `dd2` with the earlier runs of the other conditions. The site's summaries now read these reports.

## Added 2026-10-20: the guide and DD together, on 0.9.11

`docdd` ran again from the 0.9.11 code, so that it and `dd2` carry the same DD: the same 26 tasks, three
runs each with both models, judged and blind-audited the same way (six Sonnet 5.5 auditors over the 156
packets, no override in either model). No harness error and no timeout. One Haiku run
(`supermem-symbols-not-prompts-docdd-2`) held the harness for about an hour after the agent was done: a
`src/cli.js resident` process started inside the task's clone kept running, and the run returned once it
was stopped by hand. Its row is the agent's run as recorded and is kept.

| Claude Opus 5.5 | With DD 0.9.11 | Guide, referenced, and DD 0.9.11 | Same, DD 0.9.10 | Guide, referenced | No project knowledge |
|---|---|---|---|---|---|
| Resolution | 100% (95-100) | 99% (93-100) | 100% (95-100) | 100% (95-100) | 95% (88-98) |
| Code quality | 98% (96-99) | 98% (97-100) | 97% (95-99) | 97% (95-99) | 92% (89-95) |
| Project requirements met | 100% (100-100) | 100% (100-100) | 98% (93-100) | 100% (100-100) | 69% (56-82) |
| Context | 39.8k | 42.3k | 42.8k | 41.3k | 37.8k |
| Cost | $0.4344 | $0.4772 | $0.4745 | $0.5007 | $0.428 |

| Claude Haiku 5.5 | With DD 0.9.11 | Guide, referenced, and DD 0.9.11 | Same, DD 0.9.10 | Guide, referenced | No project knowledge |
|---|---|---|---|---|---|
| Resolution | 99% (93-100) | 97% (91-99) | 99% (93-100) | 97% (91-99) | 92% (84-96) |
| Code quality | 97% (95-99) | 97% (95-99) | 96% (94-98) | 97% (95-99) | 85% (81-90) |
| Project requirements met | 98% (93-100) | 98% (93-100) | 98% (93-100) | 98% (93-100) | 43% (30-57) |
| Context | 48.5k | 58.8k | 56.2k | 54.8k | 46.1k |
| Cost | $0.0236 | $0.0256 | $0.0258 | $0.0231 | $0.0205 |

- **The guide adds nothing DD does not already give.** Paired by task against `dd2`, with both on 0.9.11,
  the project's requirements are level (a paired difference of 0 with each model), resolution is one run
  lower with each (−1.3 points: Opus −3.8 to 0, Haiku −6.4 to 2.6), and quality rounds to the same value. The one unresolved Opus run broke an existing
  test (`supermem-keyword-ies-plural-docdd-1`); Haiku's two are a wrong SIE export and a wrong
  implementation of `supermem-symbols-not-prompts`.
- **It costs context.** The guide is read whole and DD delivers on top of it: paired with `dd2`, 4.4k tokens
  more with Opus (2.1k to 7.2k) and 5.6k with Haiku (3.1k to 7.9k), the most of any condition. With Opus
  that is $0.043 more per task ($0.003 to $0.084); with Haiku the cost difference does not clear zero.
- **0.9.11's advisory line holds with the guide too.** Haiku runs that added duplicate skipping to
  ledgerkit changes that did not ask for it fell from 8 (0.9.10) to 2, both in `ledgerkit-usd-import`, as
  with `dd2`. Checks failed for scope fell from 10 runs to 8; the rest are scratch files committed and
  refactors beyond the task. No run of either model took the false correction turn.

Data: `data/bench-2026-10-fix-{haiku,opus}.report.json` now carry five conditions, the 0.9.11 `dd2` and
`docdd` beside the earlier runs of the other three; `.judge.json` holds the judge's and the audit's
verdicts for the 0.9.11 runs, and `-docdd.audit-verdicts.jsonl` the new audit. The site's landing reads
the new condition as "With documentation + DD".

## Reproduce

```bash
node src/eval/bench/run.js --check-only
node src/eval/bench/run.js --model=claude-haiku-5-5 --effort=high --conditions=none --repeat=3 --no-suite \
  --out=bench-2026-10/calibration/results.json
node src/eval/bench/calibrate.js --in=bench-2026-10/calibration/results.json --out=docs/benchmarks/data/bench-2026-10-calibration.json
node src/eval/bench/run.js --model=claude-opus-5-5 --effort=high --selection=docs/benchmarks/data/bench-2026-10-calibration.json \
  --repeat=3 --conc=3 --out=bench-2026-10/opus/results.json      # --resume until every job has a row
node src/eval/agent/judge.js --in=bench-2026-10/opus/results.json --model=claude-opus-5-5 --conc=2   # --resume
node src/eval/agent/audit.js --in=bench-2026-10/opus/results.json      # then --apply=<verdicts>.jsonl
node src/eval/bench/report.js --in=bench-2026-10/opus/results.json
# the same for Haiku; then totals.js over both reports
```

Patriark's runs need the Patriark repository beside this one; its setups and solutions are generated from
it into `output/eval` (`projects/patriark/generate.mjs`), never kept here.
