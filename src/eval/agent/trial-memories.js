// The store of the v2 agent trial:
// thirteen memories about this codebase, each something a capable agent would
// not derive from the code and that no test enforces. Seven bear on a task of
// tasks-v2.js; six are realistic knowledge no task needs, so the trial also
// measures what DD delivers when nothing applies. Written before the tasks and
// not edited after them.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { codeSymbols, repoFilesOf, triggerWarnings } from '../../engine/compile.js';

const CREATED = '2026-10-14T12:00:00.000Z';

export const TRIAL_MEMORIES = [
  {
    topic: 'testing/sqlite-handle-before-rm', kind: 'trap',
    title: 'Close every node:sqlite handle before removing its folder',
    body: 'On Windows, `rmSync` of a folder that still holds an open `telemetry.sqlite` fails with EPERM, so a test that opens the telemetry database itself (`openTelemetry`, `DatabaseSync`) must close it before the project folder goes. `t.after` hooks run in registration order: register the close before the removal, or do both in one hook (`t.after(() => { db.close(); rmSync(root, ...) })`, as tests/maintenance/telemetry.test.js does). Functions that open the database on their own (`maintain`, `healthReport`, `recall`) close it in `finally` and need nothing from the caller.',
    not_derivable: 'Linux and macOS remove the folder with the handle open; the EPERM shows only on Windows, in the cleanup hook, far from the line that opened the database.',
    triggers: [
      { on: ['read'], paths: ['tests/maintenance/*.test.js'] },
      { on: ['edit', 'write'], paths: ['tests/maintenance/**', 'tests/ui/**'], symbols: ['openTelemetry', 'DatabaseSync'] },
      { on: ['prompt', 'search'], keywords: ['telemetry test', 'sqlite handle', 'EPERM'] },
    ],
    evidence: [{ path: 'tests/maintenance/telemetry.test.js', summary: 'Closes the handle in t.after before removing the folder.' }],
  },
  {
    topic: 'testing/npm-test-scripts', kind: 'procedure',
    title: 'Every test script isolates data, runs files one at a time and quotes its globs',
    body: 'A `test*` script in package.json carries three things. `--import ./tests/helpers/isolate-data.js`: it sets DD_MAINTENANCE=0, without which a session start inside a test spawns a detached maintenance run that holds files in the temp project the test then deletes (EPERM, intermittent). `--test-concurrency=1`: tests spawn hooks and create temp projects that collide when files run in parallel. Quoted glob patterns such as "tests/capture/**/*.test.js": node expands them itself; unquoted, the shell expands them differently per platform and `**` loses its meaning.',
    not_derivable: 'Nothing checks the scripts; the failures are intermittent EPERMs and files skipped on another platform, days later.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['package.json'] },
      { on: ['prompt', 'search'], keywords: ['test script', 'npm script', 'node --test'] },
    ],
    evidence: [{ path: 'package.json', summary: 'Every test script has the three parts.' }, { path: 'tests/helpers/isolate-data.js', summary: 'What the import does.' }],
  },
  {
    topic: 'engine/compiled-index-version', kind: 'procedure',
    title: 'A change to the compiled index shape bumps INDEX_VERSION',
    body: 'Hooks read `.dd/local/v2/index.json` as `loadIndex` (src/engine/index-file.cjs) returns it and ignore an index whose `version` is not `INDEX_VERSION`, until the next session start recompiles. When a change adds, removes or renames a key the hot path reads (the index top level, `memories[id]`, a clause, a check), raise `INDEX_VERSION` in src/engine/index-file.cjs and update the shape test in tests/engine/v2/compile.test.js. Otherwise an index compiled by the previous version is read by the new code and the field is missing or misread in every hook of every user until a session restarts. Bodies files are named by the index: never read bodies from another build.',
    not_derivable: 'Compile and the hooks run in different processes and versions; a test that compiles and reads with the same code never sees the stale index.',
    triggers: [
      { on: ['read'], paths: ['src/engine/index-file.cjs'] },
      { on: ['edit', 'write'], paths: ['src/engine/compile.js', 'src/engine/index-file.cjs', 'src/engine/match.cjs'] },
      { on: ['prompt', 'search'], keywords: ['compiled index', 'index.json', 'INDEX_VERSION'] },
    ],
    evidence: [{ path: 'src/engine/index-file.cjs', summary: 'Versions 3 and 4 and what each changed.' }],
  },
  {
    topic: 'telemetry/append-whole-lines', kind: 'trap',
    title: 'Telemetry files are read by byte offset: append whole lines',
    body: 'Maintenance rolls session files and `.dd/local/telemetry/*.jsonl` into telemetry.sqlite by byte offset (`appended()` in src/maintenance/telemetry.js): from the offset it stored for the file to the last newline, whole lines only. A writer appends each record as one JSON line ending in a newline (`appendTelemetry` in src/capture/telemetry.js does) and never rewrites the file: a record without its newline waits forever, a rewritten file is read again from its old offset and counted twice. A new file also needs its own offset key in `rollUp`, as `telemetry/checks.jsonl` and `telemetry/inbox.jsonl` have, or nothing of it is rolled up.',
    not_derivable: 'The reader lives in maintenance, the writers in capture and checks; nothing fails at write time, the counters are wrong days later.',
    triggers: [
      { on: ['read'], paths: ['src/maintenance/telemetry.js'] },
      { on: ['edit', 'write'], paths: ['src/capture/**', 'src/checks/**', 'src/maintenance/**'], symbols: ['appendFileSync', 'writeFileSync', 'appendTelemetry'] },
      { on: ['prompt', 'search'], keywords: ['telemetry', 'roll-up', 'rollup', 'jsonl'] },
    ],
    evidence: [{ path: 'src/maintenance/telemetry.js', summary: 'appended() reads whole lines from a stored offset.' }, { path: 'src/capture/telemetry.js', summary: 'The writer every telemetry line goes through.' }],
  },
  {
    topic: 'store/writes-go-through-commit', kind: 'procedure',
    title: 'Every change to a memory goes through the store commit, then a recompile',
    body: 'Write `.dd/memories/*.json` only through `createMemoryFiles(ddDir).commit({ put, remove })` (src/memory/store.js): it validates, keeps one live memory per topic, journals the write under the store lock, and rewrites `memories/manifest.json`, whose hash is what tells hooks their compiled index is stale. Then recompile with `compileProject` (src/engine/compile.js): hooks never recompile on their own. A file written directly, or a commit without a recompile, leaves a running session delivering the old index until its next session start. The review actions in src/ui/actions.js (archive, restore, edit, accept, delete, merge) do both: a new entry point calls them instead of writing files.',
    not_derivable: 'A direct write looks right in the store and in `deltadictum status`; only a running session shows the stale delivery.',
    triggers: [
      { on: ['read'], paths: ['src/memory/store.js', 'src/ui/actions.js'] },
      { on: ['edit', 'write'], paths: ['src/cli.js', 'src/ui/**', 'src/memory/**', 'src/maintenance/**'], symbols: ['writeFile', 'writeFileSync', 'writeJson'] },
      { on: ['prompt', 'search'], keywords: ['archive a memory', 'memory file', 'manifest'] },
    ],
    evidence: [{ path: 'src/memory/store.js', summary: 'commit rewrites the manifest hooks compare with the index.' }, { path: 'src/ui/actions.js', summary: 'Every review action commits, then recompiles.' }],
  },
  {
    topic: 'capture/footprint-order-by-time', kind: 'trap',
    title: 'Footprint entries are ordered by their hook start time, not by file position',
    body: '`readFootprint` (src/capture/footprint.js) sorts entries by `at`, the hook process start (`performance.timeOrigin`), because post-tool hooks are asynchronous and a slower one appends after the next tool\'s hook. Stop (src/checks/turn.js) reads the turn as everything after the last `turn` marker in that order, and the marker carries the real time of the Stop. A test fixture that appends entries by hand gives them `at` values that increase with the story, and after a Stop uses `new Date().toISOString()` or fixes the Stop\'s `now` to match: an entry with a fixed timestamp older than the marker sorts before it and silently leaves the turn.',
    not_derivable: 'The appends look ordered in the file; the sort by time is applied on read, in another module.',
    triggers: [
      { on: ['read'], paths: ['src/capture/footprint.js', 'src/checks/turn.js'] },
      { on: ['edit', 'write'], paths: ['tests/capture/**', 'tests/hooks/**'], symbols: ['appendFootprint', 'footprintPath'] },
      { on: ['prompt', 'search'], keywords: ['footprint', 'turn marker', 'Stop hook test'] },
    ],
    evidence: [{ path: 'src/capture/footprint.js', summary: 'readFootprint sorts by at, stably.' }],
  },
  {
    topic: 'storage/derived-files-under-local', kind: 'decision',
    title: 'Everything DD derives lives under .dd/local, ignored by .dd/.gitignore',
    body: 'Memories (`.dd/memories/*.json`) and `.dd/config.json` are the only files DD keeps in git. Everything derived (the compiled index, session ledgers and footprints, telemetry, requests, the maintenance marker) goes under `.dd/local/`, which `.dd/.gitignore` ignores; `ensureIgnored` (src/memory/ignore.js) writes that file from DERIVED_ENTRIES (`local/`, `memories/manifest.json`, `inbox/`). A new derived file goes under `.dd/local/` (see `localPaths` in src/engine/locate.cjs) or its path is added to DERIVED_ENTRIES. DD never writes the project\'s root .gitignore: it is the user\'s.',
    not_derivable: 'A file written elsewhere under .dd/ shows up in every user\'s git status, after the change shipped.',
    triggers: [
      { on: ['read'], paths: ['src/engine/locate.cjs', 'src/memory/ignore.js'] },
      { on: ['edit', 'write'], paths: ['src/maintenance/**', 'src/capture/**', 'src/ui/**', 'src/memory/**'], symbols: ['writeFileSync', 'appendFileSync', 'writeFile', 'mkdirSync'] },
      { on: ['prompt', 'search'], keywords: ['gitignore', 'derived file', 'dd/local'] },
    ],
    evidence: [{ path: 'src/memory/ignore.js', summary: 'DERIVED_ENTRIES and how .dd/.gitignore is written.' }, { path: 'src/engine/locate.cjs', summary: 'localPaths names every derived location.' }],
  },
  {
    topic: 'tooling/bash-tool-backslashes', kind: 'trap',
    title: 'Write files that contain backslashes with Write or Edit, never through the shell',
    body: 'The Bash tool collapses `\\\\` even inside a quoted heredoc, so a regular expression, a `\\n` inside a string or a Windows path written with `cat <<EOF`, `sed` or `node -e` lands on disk with its backslashes halved. Write or edit such a file with the Write or Edit tool; use the shell only to run things.',
    not_derivable: 'The file looks right in the command and wrong on disk; a test fails later with a pattern that no longer matches.',
    triggers: [
      { on: ['run'], commands: ['node -e', 'sed -i'] },
      { on: ['prompt', 'search'], keywords: ['heredoc', 'backslash', 'backslashes'] },
    ],
    evidence: [{ path: 'src/hooks/observe.js', summary: 'Patterns written with String.raw after a shell write halved them (2026-10-12).' }],
  },
  {
    topic: 'hooks/codex-payload-shapes', kind: 'fact',
    title: 'Codex payload shapes come from recordings, not documentation',
    body: 'Codex (codex-cli 0.154, recorded 2026-09) sends its shell tool as `tool_name: Bash` with `tool_input.command` either a string or an argv such as `["bash", "-lc", "<script>"]` (PowerShell: `["pwsh", "-Command", ...]`), `apply_patch` with the patch text in `tool_input.command`, and `tool_response: { exit_code, output }`; its Stop takes `{ decision: "block", reason }`. tests/hooks/codex.test.js pins those shapes. A field Codex renames is seen only in a live session: record payloads with DD_CAPTURE_PAYLOADS before trusting a documented shape.',
    not_derivable: 'A documented hook payload differed from what the harness sent; only recordings say which fields exist.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/hooks/v2/codex.cjs', 'tests/hooks/codex.test.js', 'docs/guide/how-it-works.md'] },
      { on: ['prompt', 'search'], keywords: ['codex', 'apply_patch'] },
    ],
    evidence: [{ path: 'src/hooks/v2/codex.cjs', summary: 'The adapter over the recorded shapes.' }],
  },
  {
    topic: 'integrations/opencode/bun-runtime', kind: 'fact',
    title: 'OpenCode runs plugins in Bun: the adapter imports nothing from DD',
    body: 'OpenCode loads plugins in Bun, which has no `node:sqlite`: importing any DD module there fails at load (OpenCode 1.16.2, 2026-09-24). adapters/opencode/index.js spawns `node hooks/run.cjs` and maps OpenCode tool names to Claude Code\'s; every export of the module is loaded as a plugin function, so helpers live in frame.js, not as named exports of index.js. Delivery travels with the tool result (`tool.execute.after`), not before the call, and OpenCode has no Stop hook.',
    not_derivable: 'Nothing fails on Node; the failure is in another runtime, at load time.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['adapters/**'] },
      { on: ['prompt', 'search'], keywords: ['opencode', 'bun'] },
    ],
    evidence: [{ path: 'adapters/opencode/index.js', summary: 'Spawns the hooks instead of importing DD.' }],
  },
  {
    topic: 'hooks/hot-path-commonjs', kind: 'decision',
    title: 'The hot path stays CommonJS and loads lazily',
    body: 'Every hook is a fresh Node process, so its cost is module loading. Measured on 2026-10-11: an empty .cjs costs 1.1 ms over `node -e`, an empty .mjs 3.1 ms, two ESM imports 4.7 ms, `node:crypto` 2 ms. hooks/run.cjs, src/hooks/v2/*.cjs, src/engine/*.cjs and src/checks/*.cjs are CommonJS and require a module only on the branch that needs it: a tool call that fires nothing loads only the matcher, checks load only when one applies, and tests in tests/hooks/v2-hook.test.js and tests/hooks/v2-checks.test.js assert which modules a quiet call loads. An ES module on this path, or a top-level require of crypto, costs every tool call of every user.',
    not_derivable: 'The .cjs extension shows the choice, not the measurement or the lazy-loading rule.',
    triggers: [
      { on: ['edit', 'write'], paths: ['hooks/*.cjs', 'src/hooks/v2/*.cjs', 'src/engine/*.cjs', 'src/checks/*.cjs'] },
      { on: ['prompt', 'search'], keywords: ['hook latency', 'hot path', 'PreToolUse'] },
    ],
    evidence: [{ path: 'hooks/run.cjs', summary: 'The entry point every hook command names.' }],
  },
  {
    topic: 'engine/symbol-check-excludes-dd', kind: 'trap',
    title: 'Dead-symbol checks search the code, never .dd',
    body: '`codeSymbols` (src/engine/compile.js) runs one `git grep -w -F -f -` over tracked files with `:(exclude).dd`: a memory names its own symbols, so a search that includes `.dd/` finds every symbol alive. The same exclusion applies to any new check that looks for a trigger\'s symbol, path or keyword in the repository (`genericReasons` in src/capture/generic.js reads the same listing). git answering nothing (`err.status === 1`) is an empty set; git absent is `null`, and `null` reports no symbol dead.',
    not_derivable: 'With .dd/ included every check passes; the dead symbol is never reported.',
    triggers: [
      { on: ['edit', 'write'], paths: ['src/engine/compile.js', 'src/capture/generic.js', 'src/capture/inbox.js'], symbols: ['git', 'grep', 'execFileSync'] },
      { on: ['prompt', 'search'], keywords: ['dead symbol', 'git grep'] },
    ],
    evidence: [{ path: 'src/engine/compile.js', summary: 'codeSymbols and its exclusion.' }],
  },
  {
    topic: 'tooling/no-dependencies', kind: 'decision',
    title: 'DD declares no dependencies and no devDependencies',
    body: 'package.json keeps no `dependencies` and no `devDependencies`: a host that installs the plugin runs `npm ci` in it (the Codex install guide does), so a dev tool there would be installed on every user\'s machine, and CI\'s `npm audit signatures` step runs only when the tree has a dependency. Tooling runs through `npx --yes <tool>@<pinned version>`, as `lint` does (`npx --yes eslint@10.11.0 .`), with a configuration that imports nothing (eslint.config.js). A devDependency was considered and rejected for that reason.',
    not_derivable: 'package.json shows an empty tree, not the rule; the cost lands in users\' installs, not in the repository.',
    triggers: [
      { on: ['read'], paths: ['eslint.config.js'] },
      { on: ['edit', 'write'], paths: ['package.json', 'eslint.config.js', '.github/**'] },
      { on: ['prompt', 'search'], keywords: ['devDependencies', 'dependency', 'npm install', 'prettier'] },
    ],
    evidence: [{ path: 'eslint.config.js', summary: 'Why ESLint is fetched by npx and not installed.' }],
  },
];

// A stable id per topic, so every materialization writes the same files.
export const trialMemoryId = topic => {
  const hex = createHash('sha256').update(`dd-trial-v2:${topic}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

// The memories as DD stores them, their evidence hashed against the repository at
// `root`, with the compiler's trigger warnings against that repository.
export async function materializeTrialMemories(root) {
  const memories = [];
  for (const definition of TRIAL_MEMORIES) {
    const evidence = [];
    for (const entry of definition.evidence) {
      const sha256 = createHash('sha256').update(await readFile(join(root, entry.path))).digest('hex');
      evidence.push({ type: 'file', path: entry.path, sha256, summary: entry.summary });
    }
    memories.push({ schema_version: 8, id: trialMemoryId(definition.topic), project_id: 'supermem', topic: definition.topic, kind: definition.kind,
      status: 'active', title: definition.title, body: definition.body, not_derivable: definition.not_derivable, triggers: definition.triggers,
      evidence, origin: 'user_explicit', replaces: null, revisit_when: [], review: { issues: [], accepted: { by: 'person', at: CREATED } },
      created: CREATED, updated: CREATED });
  }
  const repoFiles = repoFilesOf(root);
  const found = repoFiles ? codeSymbols(root, [...new Set(memories.flatMap(m => m.triggers.flatMap(c => c.symbols ?? [])))]) : null;
  const warnings = memories.flatMap(memory => triggerWarnings(memory, repoFiles, found ? symbol => found.has(symbol) : null));
  return { memories, warnings };
}

export const trialMemoryByTopic = topic => TRIAL_MEMORIES.find(memory => memory.topic === topic) ?? null;
