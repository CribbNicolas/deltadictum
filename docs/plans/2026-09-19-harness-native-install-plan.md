# Native install per harness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DD natively installable in each of its four target harnesses — a git-hosted marketplace for Claude Code and Grok Build, an npm-pulled plugin for OpenCode, and an `npx`-runnable installer for Codex (the one harness with no pull mechanism of its own) — without changing anything under `src/`.

**Architecture:** Every harness difference lives in a thin glue layer that either configures a harness to call an existing `src/hooks/*.js` / `src/mcp/server.js` entry point, or translates one harness's hook payload shape into the shape those entry points already expect (same pattern as the existing `--codex` branch in `src/hooks/run.js`). No harness-specific logic is duplicated into `src/`.

**Tech Stack:** Node ≥ 22, `@modelcontextprotocol/sdk`, `zod` — no new dependency.

**Spec:** [`docs/plans/2026-09-19-harness-native-install.md`](2026-09-19-harness-native-install.md)

**Task order note:** Codex (Task 3) comes before OpenCode (Task 4) even though the spec lists OpenCode
third, because Task 3 restructures `src/cli.js`'s `main()` to branch before `openStore()`, and Task 4's
`mcp` subcommand needs that restructuring already in place. Don't reorder without carrying that
dependency along.

## Global Constraints

- No dependency beyond `@modelcontextprotocol/sdk` and `zod` (L3).
- Every hook failure must degrade to "stay out of the way", never block the host (L5).
- `src/hooks/pre-tool.js`, `session-start.js`, `observe.js`, `capture.js`, `src/mcp/server.js` are not modified by this plan — verify with the grep in "Start here" below after every task.
- `npm test` and `npm run eval` must still pass after every task; neither exercises the changed files, so a failure means scope crept into `src/`.

---

## Start here: confirm the ground

Repository state changed since the spec was written — re-run these before starting, and after Task 0/1
specifically since they touch shared files:

```bash
# Core stays harness-agnostic.
grep -rniE "claude.?code|codex|opencode|grok.?build" src/hooks src/mcp   # expect: no matches

# Surprise found while planning: Grok already has partial, untested prior art. Confirm it's still there.
find .grok .grok-plugin -type f
cat .grok-plugin/marketplace.json   # current shape: {"source": {"type": "local", "path": "./"}} — wrong key shape, Task 2 fixes it

# package-lock.json still tracked (Claude Code marketplace dep auto-install depends on this).
git ls-files package-lock.json

# npm name still free (re-check again immediately before the actual publish in Task 4 — names get taken).
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/deltadictum   # expect 404

# Baseline test count, to catch any regression this plan introduces.
npm test 2>&1 | tail -5
```

If any of these disagree with what a task below assumes, stop and reconcile before writing code.

---

### Task 0: Stop stripping the legacy `decision` field only for Codex

The Claude Code host currently rejects any top-level `decision` field on `PreToolUse` output (it wants
`hookSpecificOutput.permissionDecision` or nothing). `src/hooks/pre-tool.js` always returns
`{ decision: 'allow', ... }`; `src/hooks/run.js`'s `ok()` only deletes that field when the `--codex` flag
is present, so every non-`dd__` tool call under plain Claude Code fires a hook validation error today
(confirmed live in this session). Fix belongs first because Tasks 1–2 make DD installable into *more*
Claude-Code-family projects, which would just multiply this noise.

**Files:**
- Modify: `src/hooks/run.js:13-22` (the `ok` function)
- Test: `tests/hooks/corrections.test.js` (already has a non-codex `hook()` spawn helper at line 15)

**Interfaces:**
- Consumes: `buildPreToolContext` from `src/hooks/pre-tool.js` (unchanged — still returns `{decision:'allow', hookSpecificOutput?}`)
- Produces: nothing new — `ok()`'s stdout contract changes for the plain (non-`--codex`) host only

- [ ] **Step 1: Write the failing test**

Add to `tests/hooks/corrections.test.js` (it already imports `spawn`, defines `hook(root, command, payload, extra=[])` at line 15, and `project()` at line 28 — reuse both, no new imports needed):

```js
test('the plain (non-codex) host never sees the legacy top-level allow decision on PreToolUse', async () => {
  const root = await project();
  const result = await hook(root, 'pre-tool', { tool_name: 'Read', tool_input: { file_path: 'x.js' } });
  assert.equal(result.decision, undefined);
});
```

(The fixture project has no atoms, so `buildPreToolContext` returns exactly `{decision:'allow'}` with no
`hookSpecificOutput` — the plainest case where the bug is visible.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks/corrections.test.js`
Expected: FAIL — `result.decision` is `'allow'`, not `undefined`.

- [ ] **Step 3: Write minimal implementation**

Replace `src/hooks/run.js:13-22`:

```js
function ok(payload) {
  if (payload.decision === 'allow') delete payload.decision;
  if (codexHost && command === 'stop' && payload.hookSpecificOutput?.additionalContext) {
    payload = { decision: 'block', reason: payload.hookSpecificOutput.additionalContext };
  }
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}
```

(Moves the `decision === 'allow'` strip outside the `codexHost` guard; keeps the Codex-only Stop→block
conversion exactly as it was — that one is a genuine per-harness difference, not a bug.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks/corrections.test.js tests/hooks/codex.test.js tests/hooks/pre-tool.test.js`
Expected: PASS, all three files — `codex.test.js` exercises the still-codex-gated Stop→block branch,
`pre-tool.test.js` exercises `buildPreToolContext` directly (unaffected, it's a layer below `ok()`).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: same pass count as the "Start here" baseline, plus one.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/run.js tests/hooks/corrections.test.js
git commit -m "fix: strip legacy top-level PreToolUse decision for every host, not just codex"
```

---

### Task 1: Claude Code — retire `plugin/`, add a real `.claude-plugin/` marketplace

`plugin/hooks/hooks.json` points at `../../hooks/run.cjs` — two levels above `plugin/`, i.e. it only
works when the whole repo checkout is present alongside it. It was never a self-sufficient plugin root,
just a compatibility shim. A real marketplace-installed plugin needs `${CLAUDE_PLUGIN_ROOT}` (confirmed
against Claude Code's hooks docs: relative paths in plugin-sourced hook commands are **not** resolved
relative to the hooks.json file — only `${CLAUDE_PLUGIN_ROOT}` is).

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `.claude-plugin/hooks/hooks.json`
- Modify: `package.json` (`files` array)
- Delete: `plugin/plugin.json`, `plugin/.mcp.json`, `plugin/hooks/hooks.json`, `plugin/skills/dd/SKILL.md`, `plugin/skills/dd-save/SKILL.md`, `plugin/skills/dd-audit/SKILL.md`, `plugin.json` (root)
- Delete: `scripts/sync-plugin.mjs` (synced `plugin/skills/*` from `skills/*`; nothing left to sync)
- Test: manual — `claude plugin validate .` (no automated test framework covers marketplace installs; this is the same category of manual check the Codex integration already documents)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `.claude-plugin/plugin.json` is the manifest Task 2 mirrors into `.grok-plugin/plugin.json`

- [ ] **Step 1: Write `.claude-plugin/plugin.json`**

```json
{
  "name": "deltadictum",
  "version": "0.2.0",
  "description": "DeltaDictum (DD): next-action doctrine. Admit trigger + behavior_delta + evidence. Inject budgeted forms. Audit locally. Share via git.",
  "author": {
    "name": "DeltaDictum"
  },
  "mcpServers": {
    "dd": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/mcp.js"]
    }
  }
}
```

- [ ] **Step 2: Write `.claude-plugin/hooks/hooks.json`**

Same five hooks as today's `hooks/hooks.json`, with commands rewritten to use `${CLAUDE_PLUGIN_ROOT}`:

```json
{
  "description": "DD capture and budgeted recall. Failures must not block the host.",
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs\" session-start", "timeout": 15 }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs\" pre-tool", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs\" prompt", "timeout": 15 }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs\" observe", "timeout": 15, "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/run.cjs\" stop", "timeout": 10 }] }
    ]
  }
}
```

Note this references the **existing, unmoved** `hooks/run.cjs` at the repo root — `hooks/` is not being
duplicated, only referenced with an absolute root now instead of a relative walk-up.

- [ ] **Step 3: Write `.claude-plugin/marketplace.json`** (self-listing, per Claude Code's documented
  self-referencing-marketplace pattern)

```json
{
  "name": "deltadictum",
  "owner": { "name": "DeltaDictum" },
  "description": "DD: next-action doctrine for coding agents. Trigger + behavior_delta + evidence, not session memory.",
  "plugins": [
    {
      "name": "deltadictum",
      "source": "./",
      "description": "Admit trigger + behavior_delta + evidence. Inject budgeted forms. Audit locally. Share via git."
    }
  ]
}
```

- [ ] **Step 4: Confirm `skills/` needs no change** — Claude Code auto-discovers `skills/<name>/SKILL.md`
  at the plugin root by convention, and `skills/` already exists unmoved at repo root:

```bash
ls skills/dd/SKILL.md skills/dd-save/SKILL.md skills/dd-audit/SKILL.md
```

- [ ] **Step 5: Delete the nested `plugin/` layout and its sync script**

```bash
git rm -r plugin/ plugin.json scripts/sync-plugin.mjs
```

- [ ] **Step 6: Update `package.json`'s `files` array** — remove `"plugin"` and `"plugin.json"`, add
  `.claude-plugin`:

```json
"files": [
  "src",
  ".claude-plugin",
  "adapters",
  "docs",
  "skills",
  "hooks",
  "mcp.js",
  ".mcp.json",
  "scripts"
],
```

- [ ] **Step 7: Remove the now-dead `sync:plugin` script entry from `package.json`**

Delete the line `"sync:plugin": "node scripts/sync-plugin.mjs",` from `"scripts"`.

- [ ] **Step 8: Run the full suite** — this task touches no file any test imports (`scripts/sync-plugin.mjs`
  and `plugin/` are not referenced by any test), so this should be a no-op check.

Run: `npm test`
Expected: same pass count as Task 0's ending count.

- [ ] **Step 9: Manual verification**

```bash
claude plugin validate .
```

Expected: valid marketplace and plugin manifest, no errors. If the `claude` CLI isn't available in this
environment, defer this check to the first person who runs the plan with it and note the gap in the
commit message.

- [ ] **Step 10: Commit**

```bash
git add .claude-plugin package.json
git rm -r plugin/ plugin.json scripts/sync-plugin.mjs
git commit -m "feat: add native Claude Code marketplace, retire the plugin/ compatibility shim"
```

---

### Task 2: Grok Build — fix the existing marketplace stub, add the missing plugin manifest

Discovered while confirming ground truth: `.grok-plugin/marketplace.json` already exists (from the
project's first commit) but uses a source shape (`{"type":"local","path":"./"}`) that doesn't match
Grok Build's documented schema, and there's no matching `.grok-plugin/plugin.json`. Separately,
`.grok/hooks/dd.json` and `.grok/rules/dd.md` already exist as a **project-level** Grok config (the
`.grok/hooks/` project-local discovery path, parallel to Claude Code's root `hooks/hooks.json`) — these
already work today via the same plain (non-codex) `ok()` path Task 0 just fixed, and are untouched by
this task.

**Grok Build's exact `PreToolUse`-equivalent hook payload/response contract is not confirmed** — the
public docs list discovery paths but not the JSON schema. Treat Step 2 below as provisional: it mirrors
the Claude Code shape (since `.grok/hooks/dd.json` already does, untested, and Grok Build's stated design
goal is drop-in MCP/hook compatibility with Claude Code). If manual verification in Step 4 shows Grok
Build rejecting or mishandling the `PreToolUse` hook, fall back to shipping `SessionStart` only (still
useful — matches what `.grok/rules/dd.md` already provides today) and note the gap rather than guessing
further.

**Files:**
- Modify: `.grok-plugin/marketplace.json`
- Create: `.grok-plugin/plugin.json`
- Test: manual — `grok inspect` against a project with this plugin installed

**Interfaces:**
- Consumes: `.claude-plugin/plugin.json`'s shape (Task 1) as the template — Grok Build's plugin schema is
  documented as structurally parallel
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Fix `.grok-plugin/marketplace.json`'s source field**

```json
{
  "name": "deltadictum",
  "description": "DeltaDictum (DD): next-action doctrine for coding agents",
  "owner": { "name": "DeltaDictum" },
  "plugins": [
    {
      "name": "deltadictum",
      "description": "Admit trigger + behavior_delta + evidence. Inject budgeted forms. Audit in a local UI. Share via git.",
      "source": "./"
    }
  ]
}
```

- [ ] **Step 2: Write `.grok-plugin/plugin.json`** with inline hooks (Grok Build's plugin.json accepts a
  metadata/override object per its docs; inline hooks avoids depending on an unconfirmed folder-discovery
  convention inside a plugin root):

```json
{
  "name": "deltadictum",
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/hooks/run.cjs\" session-start", "timeout": 15 }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/hooks/run.cjs\" pre-tool", "timeout": 10 }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/hooks/run.cjs\" prompt", "timeout": 15 }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/hooks/run.cjs\" observe", "timeout": 15, "async": true }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/hooks/run.cjs\" stop", "timeout": 10 }] }
    ]
  }
}
```

- [ ] **Step 3: Run the full suite** (no test imports these files)

Run: `npm test`
Expected: same pass count as Task 1's ending count.

- [ ] **Step 4: Manual verification**

```bash
grok inspect
```

Expected (in a project with the plugin installed): `deltadictum` listed under plugins, hooks, and MCP
servers, no schema errors. If Grok Build isn't available in this environment, defer to whoever runs this
task with it, and treat Task 2 as incomplete until that check runs at least once — record the result in
`docs/integrations/grok-build.md` (new file, same shape as `docs/integrations/codex.md`) once verified.

- [ ] **Step 5: If Step 4 shows the PreToolUse hook rejected or mishandled**, remove the `PreToolUse`,
  `UserPromptSubmit`, `PostToolUse`, and `Stop` blocks from `.grok-plugin/plugin.json`, keeping only
  `SessionStart` — ship the advisory-context-only version rather than a broken per-tool hook.

- [ ] **Step 6: Commit**

```bash
git add .grok-plugin
git commit -m "feat: fix Grok Build marketplace source schema, add plugin.json manifest"
```

---

### Task 3: Codex — generalize the installer behind `npx deltadictum install`

`scripts/install-codex.mjs` already does the right thing per-project (managed blocks, idempotent,
refuses to clobber an unrelated DD server) and is already tested by `tests/hooks/codex.test.js`. This
task does not rewrite it — it adds a thin CLI entry point so it's runnable via `npx deltadictum install
--host codex --project <path>` from any project without cloning DD, and leaves the exported functions
(`planCodexInstall`, `applyCodexInstall`) and their tests untouched. It also restructures `src/cli.js`'s
`main()` to branch on `command` **before** calling `openStore()` — Task 4 (OpenCode) adds one more branch
in the same spot for a `mcp` subcommand, so that restructuring needs to land here first.

**Files:**
- Modify: `src/cli.js` (add an `install` branch, before `openStore()` is called)
- Test: new — `tests/hooks/cli-install.test.js`

**Interfaces:**
- Consumes: `planCodexInstall`, `applyCodexInstall` from `scripts/install-codex.mjs` (already exported,
  unchanged signatures: `planCodexInstall(projectPath) => Promise<Plan>`, `applyCodexInstall(plan) =>
  Promise<void>`)
- Produces: `dd install --host codex --project <path> [--dry-run]` as a documented CLI surface; `main()`'s
  new `if (command === '<x>') return ...` shape before `openStore()`, which Task 4 extends with an `mcp`
  branch

- [ ] **Step 1: Write the failing test**

Create `tests/hooks/cli-install.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';

const cliPath = fileURLToPath(new URL('../../src/cli.js', import.meta.url));

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.once('error', reject);
    child.once('close', code => resolve({ code, stdout }));
  });
}

test('dd install --host codex writes Codex project files without opening the current-directory store', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dd-cli-install-'));
  const { code, stdout } = await run(['install', '--host', 'codex', '--project', root, '--dry-run']);
  assert.equal(code, 0);
  const result = JSON.parse(stdout);
  assert.equal(result.dry_run, true);
  assert.ok(result.files.some(f => f.endsWith('.codex/config.toml') || f.endsWith('.codex\\config.toml')));
  await assert.rejects(access(join(root, '.codex')));
});
```

(The last assertion is the one that matters for the "before `openStore()`" ordering: a `--dry-run` must
never touch the target project, and running the whole CLI from a directory with no `.dd` store of its own
must not crash trying to `openStore()` for the *current* directory.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hooks/cli-install.test.js`
Expected: FAIL — today `install` isn't a recognized command, and `main()` calls `openStore()`
unconditionally first, which would either throw or silently create a `.dd` in the wrong place depending
on cwd.

- [ ] **Step 3: Write minimal implementation**

Modify `src/cli.js`. Add the import and branch **before** the `openStore()` call. This also adds the
`mcp` branch that Task 4 needs (`src/mcp/server.js` is a top-level-await script with no exported entry
point — confirmed by reading it — so the branch is a plain side-effecting import):

```js
#!/usr/bin/env node
import { openStore } from './project.js';
import { startUiServer } from './ui/server.js';
import { orientProject } from './engine/project-context.js';
import { writeUiUrl } from './hooks/banner.js';
import { planCodexInstall, applyCodexInstall } from '../scripts/install-codex.mjs';

const [command, ...rest] = process.argv.slice(2);

async function runInstall(args) {
  const hostIdx = args.indexOf('--host');
  const host = hostIdx >= 0 ? args[hostIdx + 1] : undefined;
  const projectIdx = args.indexOf('--project');
  const project = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const dryRun = args.includes('--dry-run');
  if (host !== 'codex') {
    throw new Error(`install --host ${host ?? '<missing>'} is not supported. Only "codex" needs a scripted installer — Claude Code, Grok Build and OpenCode install through their own marketplace/npm mechanisms (see README).`);
  }
  if (!project) throw new Error('Usage: dd install --host codex --project PROJECT [--dry-run]');
  const plan = await planCodexInstall(project);
  if (!dryRun) await applyCodexInstall(plan);
  console.log(JSON.stringify({
    dry_run: dryRun, project: plan.projectRoot, data: plan.dataDir,
    files: plan.operations.map(op => op.path),
    next: 'Start a new Codex thread in this project. Review DD hooks in /hooks before enabling them.',
  }, null, 2));
}

async function main() {
  if (command === 'install') return runInstall(rest);
  if (command === 'mcp') { await import('./mcp/server.js'); return; }
  const { store, projectId, ddDir, dataDir } = await openStore();
  if (command === 'orient') {
    console.log(JSON.stringify(await orientProject({ action: rest.join(' ') || undefined }, { store, projectId })));
    store.close(); return;
  }
  if (command === 'maintain') {
    await store.prune();
    console.log('Local observations and telemetry pruned to configured retention limits.');
    store.close(); return;
  }
  if (command === 'reindex') {
    const result = await store.reindex();
    console.log(`reindexed ${result.atoms} atoms`);
    store.close();
    return;
  }
  if (command === 'status') {
    const { counts, total } = await store.countByLifecycle(projectId);
    console.log(JSON.stringify({ project_id: projectId, ddDir, dataDir, total, by_state: counts }, null, 2));
    store.close();
    return;
  }
  if (command === 'health') {
    const report = await store.assessDeterioration(projectId);
    console.log(JSON.stringify(report, null, 2));
    store.close();
    return;
  }
  const ui = await startUiServer({ store, projectId });
  await writeUiUrl(ddDir, ui);
  console.log(`DD - UI ${ui.url}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

Note `process.argv.slice(2)` changed to destructure `[command, ...rest]` — every other branch already
only used `command`, so this is safe; `orient`'s `process.argv.slice(3)` becomes `rest`, equivalent.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hooks/cli-install.test.js`
Expected: PASS

- [ ] **Step 5: Run the full suite** — `orient`'s arg handling changed shape; confirm nothing else broke.

Run: `npm test`
Expected: same pass count as Task 2's ending count, plus one.

- [ ] **Step 6: Update `docs/integrations/codex.md`'s Install section** to lead with the npx form,
  keeping the script form as a documented equivalent (both call the same functions, so both stay valid):

Replace the fenced block under `## Install` (currently three `node scripts/...` lines) with:

```powershell
npx deltadictum install --host codex --project "C:/dev/Perfect Brew" --dry-run
npx deltadictum install --host codex --project "C:/dev/Perfect Brew"
node scripts/check-codex.mjs --project "C:/dev/Perfect Brew"
```

Add one sentence above it: "Runs without cloning this repository — `npx` fetches the published
`deltadictum` package. (`scripts/install-codex.mjs`'s `planCodexInstall`/`applyCodexInstall` remain
available directly for anyone working from a source checkout.)"

- [ ] **Step 7: Commit**

```bash
git add src/cli.js tests/hooks/cli-install.test.js docs/integrations/codex.md
git commit -m "feat: add npx-runnable dd install --host codex, no repo clone required"
```

---

### Task 4: OpenCode — thin hook-shim adapter, published to npm

OpenCode pulls plugins straight from npm (`plugin: ["pkg-name"]` in `opencode.json`) — no installer
script needed, but it does require an actual `npm publish`, and a real npm-importable module whose export
shape isn't fully confirmed from docs alone (only the hook *names* are documented, not the exact call
signature). Step 1 resolves that before any shim code is written. The `dd mcp` subcommand this task's
`adapters/opencode.json` config relies on was added in Task 3 — do this task after Task 3, not before.

**Files:**
- Create: `adapters/opencode/index.js`
- Modify: `package.json` (`exports`, `version` if publishing, `files`)
- Modify: `adapters/opencode.json`
- Test: manual — a real OpenCode session with the plugin loaded (no local automated harness for OpenCode
  exists in this repo)

**Interfaces:**
- Consumes: `buildPreToolContext` from `src/hooks/pre-tool.js`, `buildSessionStartContext` from
  `src/hooks/session-start.js`, `openStore` from `src/project.js` (all already used elsewhere, no
  signature changes); the `dd mcp` subcommand from Task 3
- Produces: `adapters/opencode/index.js`'s default export — an OpenCode plugin function — consumed only
  by OpenCode itself, not by any other task

- [ ] **Step 1: Confirm the exact plugin export signature against a real reference plugin** before
  writing the shim. Two independent npm packages surfaced during research as real, installed OpenCode
  plugins: `@sveltejs/opencode` and `opencode-helicone-session`. Read one's source (`npm view
  <pkg> repository.url`, then read the plugin entry file it points at, or `npm pack <pkg> && tar xf
  *.tgz` and read the unpacked source) to confirm: the default export's parameter shape (what `directory`,
  `client`, `project` etc. actually look like at call time), the exact argument shapes for
  `tool.execute.before` and `session.created`, and how a hook returns text that ends up injected into the
  model's context (a return value, a mutation on a passed object, or something else). Write the confirmed
  shape as a comment at the top of `adapters/opencode/index.js` before Step 2, citing the package and
  version read.

- [ ] **Step 2: Write `adapters/opencode/index.js`** (skeleton below implements the documented hook
  *names*; adjust the exact argument destructuring to match what Step 1 confirmed):

```js
import { buildPreToolContext } from '../../src/hooks/pre-tool.js';
import { buildSessionStartContext } from '../../src/hooks/session-start.js';
import { openStore } from '../../src/project.js';

export default async function DeltaDictum({ directory }) {
  let stateP;
  function state() {
    return stateP ??= openStore({ cwd: directory });
  }

  return {
    event: async ({ event }) => {
      if (event.type !== 'session.created') return;
      const { store, projectId } = await state();
      const result = await buildSessionStartContext({
        store, projectId, source: 'startup', sessionId: event.properties?.sessionID,
      });
      return result.hookSpecificOutput ? { context: result.hookSpecificOutput.additionalContext } : undefined;
    },
    'tool.execute.before': async (input, output) => {
      const { store, projectId } = await state();
      const result = await buildPreToolContext({
        toolName: input.tool,
        toolInput: output.args,
        session_id: input.sessionID,
      }, { store, projectId });
      if (result.hookSpecificOutput?.additionalContext) {
        output.metadata = { ...output.metadata, dd: result.hookSpecificOutput.additionalContext };
      }
    },
  };
}
```

- [ ] **Step 3: Add `package.json` `exports`**

```json
"exports": {
  ".": "./adapters/opencode/index.js"
},
```

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: same pass count as Task 3's ending count — `adapters/opencode/index.js` isn't imported by any
test yet, so this just confirms `package.json`'s `exports` addition didn't break module resolution
elsewhere.

- [ ] **Step 5: Decide and record the npm publish name** — re-run the registry check from "Start here"
  immediately before publishing (names can be taken between planning and now):

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/deltadictum
```

**Stop here and confirm with the user before running `npm publish`** — publishing an npm name is
effectively irreversible (the unpublish policy is restrictive) and this plan should not make that call
unilaterally. Confirm scoped (`@<org>/deltadictum`) vs. unscoped `deltadictum`.

- [ ] **Step 6: Publish** (only after the confirmation above)

```bash
npm publish --dry-run   # inspect the file list first
npm publish
```

- [ ] **Step 7: Update `adapters/opencode.json`** to the real config, replacing the current hand-edited
  placeholder template — uses the `dd mcp` subcommand Task 3 added, not a `deltadictum-mcp` bin entry (no
  new bin needed):

```json
{
  "plugin": ["deltadictum"],
  "mcp": {
    "dd": {
      "type": "local",
      "command": ["npx", "-y", "deltadictum", "mcp"],
      "environment": { "DD_PROJECT_DIR": "<absolute-project-path>" },
      "enabled": true
    }
  }
}
```

- [ ] **Step 8: Manual verification** — a real OpenCode session in a project with `"plugin":
  ["deltadictum"]` configured; confirm `session.created` and `tool.execute.before` fire without error and
  DD's advisory context appears.

- [ ] **Step 9: Commit**

```bash
git add adapters package.json
git commit -m "feat: add OpenCode plugin adapter, publish to npm"
```

---

### Task 5: Close out — version, done-when verification

**Files:**
- Modify: `package.json` (`version`)
- Create: `docs/integrations/grok-build.md`, `docs/integrations/opencode.md` (only once Tasks 2/4's
  manual verification steps have actually run — do not write a "verified" doc section describing a check
  that wasn't performed)

- [ ] **Step 1: Bump `package.json`'s `version`** from `0.2.0` to `0.3.0` — this plan changes the public
  install surface (new manifests, new CLI subcommand, first npm publish), which is a minor bump, not a
  patch.

- [ ] **Step 2: Run the full done-when checklist from the spec**

```bash
npm test                                    # full suite, same or higher pass count than Task 0's baseline
npm run eval                                # f1 >= 0.9, exact >= 90% — this plan touches no retrieval code, should be unchanged
claude plugin validate .                    # Task 1
grok inspect                                # Task 2, in a project with the plugin installed
npx deltadictum install --host codex --project <other-project> --dry-run   # Task 3, from outside this repo — use `npm pack` + a tmp checkout, not `npm link`, to catch path-resolution bugs `npm link` would hide
node scripts/check-codex.mjs --project <other-project>
# Task 4: real OpenCode session with "plugin": ["deltadictum"] configured
```

- [ ] **Step 3: Commit**

```bash
git add package.json docs/integrations/
git commit -m "chore: v0.3.0 — native install across Claude Code, Grok Build, OpenCode, Codex"
```
