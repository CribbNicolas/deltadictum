// The supermem bench store (docs/superpowers/plans/2026-10-16-bench-04-supermem.md): the lessons of
// fifteen verified v2 fix commits, written from the mining report before any task, plus the thirteen
// memories of the 2026-10-14 trial. Paths are those of the fixes' parents; some moved later, and the
// compiler's dead-glob warnings for them are expected at other bases.
import { TRIAL_MEMORIES } from '../../../agent/trial-memories.js';

const MINED = [
  {
    topic: 'checks/crlf-edit-match', kind: 'trap',
    title: 'Judge Edit text with LF, not the file\'s CRLF',
    body: 'Git for Windows checks files out with CRLF line ends, but the Edit tool\'s old_string and new_string use plain newlines. Normalise the file content and both edit strings to LF before matching or applying an Edit in a check, or a multi-line edit never matches on Windows and the check stays silent there while it fires on CI.',
    not_derivable: 'Depends on the host Edit tool\'s newline convention and on core.autocrlf; Linux CI never shows it.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/checks/tool.cjs'] },
      { on: ['prompt', 'search'], keywords: ['crlf', 'multi-line edit', 'windows'] },
    ],
    evidence: [{ path: 'src/checks/tool.cjs', summary: 'Applies an Edit to the file content for edit checks.' }],
  },
  {
    topic: 'checks/run-is-not-edit', kind: 'trap',
    title: 'git diff lists every uncommitted change, not this turn\'s',
    body: 'To decide whether a command changed a file a check named, compare the file\'s modification time with the previous Stop marker; never use `git diff --name-only`. The diff includes uncommitted work from before the turn, so merely running the flagged test file looked like editing it and the violation was reported again.',
    not_derivable: 'Shows only in a session that starts with uncommitted edits, which no single test sets up by accident.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/checks/turn.js'] },
      { on: ['prompt', 'search'], keywords: ['git diff', 'mtime', 'reported again'] },
    ],
    evidence: [{ path: 'src/checks/turn.js', summary: 'Turn checks over the files a turn changed.' }],
  },
  {
    topic: 'checks/js-regex-empty-class', kind: 'fact',
    title: 'In JavaScript a ] right after [ closes the class',
    body: 'In a JavaScript regular expression `[]` is an empty class and `[^]` matches any character. Unlike PCRE, a `]` right after `[` or `[^` is not a literal, so a scanner that skips it as one swallows the rest of the pattern and never sees the nested quantifier that follows.',
    not_derivable: 'The PCRE reading is the habit; the difference shows only on that one edge of the syntax.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/checks/pattern.cjs'] },
      { on: ['prompt', 'search'], keywords: ['regex', 'character class', 'backtrack'] },
    ],
    evidence: [{ path: 'src/checks/pattern.cjs', summary: 'The structural guard for check patterns.' }],
  },
  {
    topic: 'engine/glob-star-chains', kind: 'trap',
    title: 'Collapse chained **/ before compiling a glob',
    body: 'Each `**/` in a glob compiles to an optional group, and a chain of them backtracks exponentially on a path the glob does not match. Collapse runs of `**/` into one before building the regular expression; matching runs on every PreToolUse, so one such glob in a store makes every tool call hang.',
    not_derivable: 'The cost shows only on a path the glob misses; every test that matches returns at once.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/engine/clause.cjs'] },
      { on: ['prompt', 'search'], keywords: ['glob', 'hang', 'slow hook'] },
    ],
    evidence: [{ path: 'src/engine/clause.cjs', summary: 'globToRegExp.' }],
  },
  {
    topic: 'maintenance/telemetry-busy-timeout', kind: 'trap',
    title: 'telemetry.sqlite has several writer processes',
    body: 'The detached maintenance run, the review UI and the CLI open telemetry.sqlite from different processes. Set a busy timeout when the database is opened (`PRAGMA busy_timeout`) so a writer waits out another process\'s transaction; without it the second writer fails at once with "database is locked".',
    not_derivable: 'A cross-process effect: each process\'s code and tests look correct alone.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/maintenance/telemetry.js'], symbols: ['openTelemetry'] },
      { on: ['prompt', 'search'], keywords: ['sqlite', 'database is locked', 'locked'] },
    ],
    evidence: [{ path: 'src/maintenance/telemetry.js', summary: 'openTelemetry.' }],
  },
  {
    topic: 'hooks/session-cwd', kind: 'fact',
    title: 'Tool paths are relative to the session folder, not the repository root',
    body: 'Claude Code may start in a subfolder of the repository, and the Bash tool keeps its folder after a `cd`. Resolve a tool\'s relative paths from the payload\'s `cwd` before making them relative to the repository root, and compare with forward slashes only, so a Windows root reads the same in both.',
    not_derivable: 'Host behaviour: every test that starts at the repository root passes either way.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/hooks/v2/events.cjs', 'src/hooks/v2/hook.cjs'] },
      { on: ['prompt', 'search'], keywords: ['cwd', 'monorepo', 'subfolder'] },
    ],
    evidence: [{ path: 'src/hooks/v2/events.cjs', summary: 'toolEvent and bashPaths.' }],
  },
  {
    topic: 'engine/compile-overlap', kind: 'trap',
    title: 'Concurrent compiles can delete each other\'s bodies',
    body: 'Compiles run at the same time from hooks, session start and maintenance. A compile must remove the bodies files of other builds only when they are old (about a minute), the index must be recompiled at session start when the bodies file it names is gone, and nothing is delivered or claimed without its body.',
    not_derivable: 'Needs two processes interleaved; a single compile in a test never shows it.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/engine/compile.js', 'src/engine/index-file.cjs'], symbols: ['writeCompiled'] },
      { on: ['prompt', 'search'], keywords: ['bodies', 'compile', 'missing body'] },
    ],
    evidence: [{ path: 'src/engine/compile.js', summary: 'writeCompiled.' }],
  },
  {
    topic: 'engine/windows-rename-retry', kind: 'trap',
    title: 'Windows refuses a rename over a file another process has open',
    body: 'Renaming the new index over the old one fails for a moment with EPERM, EBUSY or EACCES while a hook process has the file open. Retry a few times with short waits, then let the error stand, and never leave the temporary file behind.',
    not_derivable: 'A Windows file-locking behaviour; Linux and macOS rename over open files.',
    triggers: [
      { on: ['edit', 'write'], paths: ['src/engine/compile.js'], symbols: ['renameSync'] },
      { on: ['prompt', 'search'], keywords: ['EPERM', 'rename', 'windows'] },
    ],
    evidence: [{ path: 'src/engine/compile.js', summary: 'Writes the index through a rename.' }],
  },
  {
    topic: 'engine/dead-symbol-search', kind: 'trap',
    title: 'git grep for trigger symbols must leave .dd out',
    body: 'Every memory names its own symbols inside `.dd/`, so a search over the whole repository always finds them and no symbol is ever reported dead. Search the tracked code with one `git grep -w -F -f -` excluding `.dd` (`:(exclude).dd`), and read exit status 1 as "none found".',
    not_derivable: 'Self-reference shows only on a real store; a test whose fixture has no .dd sees nothing wrong.',
    triggers: [
      { on: ['edit', 'write'], paths: ['src/engine/compile.js'], symbols: ['codeSymbols'] },
      { on: ['prompt', 'search'], keywords: ['dead symbol', 'git grep'] },
    ],
    evidence: [{ path: 'src/engine/compile.js', summary: 'Trigger warnings for dead symbols.' }],
  },
  {
    topic: 'skills/plugin-root-cli', kind: 'fact',
    title: 'Skills run the installed plugin\'s CLI, never npx',
    body: 'A marketplace install is a checkout in Claude Code\'s plugin cache with no deltadictum on PATH, so `npx deltadictum` downloads the published package: a network call and possibly another version than the one installed. Skill bodies run `node "${CLAUDE_PLUGIN_ROOT}/src/cli.js" <command>`, which Claude Code substitutes; Codex does not, so its installer writes the real root into its copies.',
    not_derivable: 'Host behaviour of plugin installs; in a development checkout npx finds the local package.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['skills/recall/SKILL.md', 'skills/review/SKILL.md', 'scripts/install-codex.mjs'] },
      { on: ['prompt', 'search'], keywords: ['npx', 'plugin root', 'marketplace install'] },
    ],
    evidence: [{ path: 'skills/recall/SKILL.md', summary: 'The recall skill.' }],
  },
  {
    topic: 'capture/fix-starts-at-validation', kind: 'decision',
    title: 'Only a failing validation run starts a fix',
    body: 'A failed Edit, a missing file or a grep with no match is routine, not a failure to learn from. Mark the commands that run tests, lint or type checks in the footprint and let only their failures start a fix; otherwise Stop asks for a memory after ordinary turns and people learn to ignore it.',
    not_derivable: 'A product decision about when capture interrupts; the code before it treated every failure alike.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/capture/footprint.js', 'src/hooks/observe.js'], symbols: ['findEvidence'] },
      { on: ['prompt', 'search'], keywords: ['stop asks', 'fix', 'capture'] },
    ],
    evidence: [{ path: 'src/capture/footprint.js', summary: 'findEvidence.' }],
  },
  {
    topic: 'delivery/claim-only-delivered', kind: 'trap',
    title: 'Claim only the memories that were delivered whole',
    body: 'A delivery has a 10,000-character field. Fit the memories first, claim in the session ledger only those that fit whole, and name the rest in the "... and N more" line without claiming them, so they arrive in full at the next event. A named memory marked delivered never arrives.',
    not_derivable: 'The claim and the fit live in different modules; one short memory in a test never fills the field.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/engine/deliver.cjs', 'src/hooks/v2/hook.cjs'] },
      { on: ['prompt', 'search'], keywords: ['and N more', 'claim', 'delivered whole'] },
    ],
    evidence: [{ path: 'src/engine/deliver.cjs', summary: 'Delivery rendering.' }],
  },
  {
    topic: 'checks/git-show-relative', kind: 'trap',
    title: 'Use HEAD:./path when the project is a subfolder of its repository',
    body: '`git show HEAD:path` reads path from the repository root. When the DD project is a subfolder of its git repository, read the committed version with `HEAD:./path`, which is relative to the working directory that `git -C <project>` sets; otherwise nothing is found and every committed violation counts as the turn\'s.',
    not_derivable: 'A git path rule; every fixture whose project is the repository root passes either way.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/checks/turn.js'] },
      { on: ['prompt', 'search'], keywords: ['git show', 'subfolder', 'committed'] },
    ],
    evidence: [{ path: 'src/checks/turn.js', summary: 'Reads the committed version of a file.' }],
  },
  {
    topic: 'engine/symbols-not-prompts', kind: 'decision',
    title: 'Symbols match what the agent does, never a prompt',
    body: 'A trigger symbol stands for code the agent writes, runs or searches for. A prompt that merely names the symbol must not fire it: people mention functions all the time, and firing on mention brings the memory in when nobody is touching the code.',
    not_derivable: 'A design decision about the trigger language; the matcher before it applied symbols to every event.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/engine/clause.js', 'src/engine/clause.cjs'] },
      { on: ['prompt', 'search'], keywords: ['trigger symbol', 'fires on prompt'] },
    ],
    evidence: [],
  },
  {
    topic: 'capture/inbox-ignore-first', kind: 'procedure',
    title: 'The inbox is git-ignored at the first ingestion, not at the first compile',
    body: 'Rejected proposals stay in `.dd/inbox`. Make sure `.dd/.gitignore` lists the inbox before the first ingestion returns, even when it rejects the proposal, because a compile (which also writes the ignore file) may not have run yet in a new project.',
    not_derivable: 'The ordering between ingestion and compile in a fresh project; projects with a compiled index never show it.',
    triggers: [
      { on: ['read', 'edit', 'write'], paths: ['src/capture/inbox.js', 'src/memory/ignore.js'] },
      { on: ['prompt', 'search'], keywords: ['inbox', 'gitignore', 'untracked'] },
    ],
    evidence: [{ path: 'src/capture/inbox.js', summary: 'Ingestion of inbox proposals.' }],
  },
];

export const MEMORIES = [...MINED, ...TRIAL_MEMORIES];
