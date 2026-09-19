# Auto-accept high-confidence candidates — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a human pre-authorize DD to promote `candidate` memories to `active` automatically, above a
configured confidence threshold, without weakening who is allowed to call `admitMemory` — plus a
per-user "never seen" indicator and better review filters in the audit UI.

**Architecture:** All new logic runs inside the existing audit-UI process (`src/ui/server.js`), the only
place that already holds the `HUMAN_REVIEW` capability. A sweep function tries `admitMemory` for
qualifying candidates and lets its existing internal checks decide safety — no new safety logic is
written. Config is per-project (`.dd/config.json`, already git-tracked); "seen" state is per-user (a new
file beside the existing per-user data-base directory). No new dependency, no background timer.

**Tech Stack:** Node ≥ 22, `node:test`, existing `@modelcontextprotocol/sdk` + `zod` only.

**Spec:** [`docs/plans/2026-09-19-auto-accept-memories.md`](2026-09-19-auto-accept-memories.md)

## Global Constraints

- No dependency beyond what's already in `package.json`.
- No `setInterval`/timer/background worker anywhere (plugin-constraints.md forbids this outright).
- Zero additional model calls anywhere in this feature.
- `admitMemory`'s `actor: HUMAN_REVIEW` gate is never bypassed, duplicated, or weakened — every task
  that promotes a memory does so by calling the existing `admitMemory`, unchanged.
- `npm test` and `npm run eval` must pass after every task; `npm run eval` should show **zero** change
  (this plan touches no retrieval/ranking code) — a diff there means scope crept out of bounds.

---

## Start here: confirm the ground

```bash
# These are the exact lines every task below assumes. If any disagree, stop and reconcile first.
grep -n "HUMAN_REVIEW = Symbol" src/engine/lifecycle.js
grep -n "auto_admit:" src/store/paths.js          # the dead per-type field this plan does NOT touch
grep -n "GROK_PLUGIN_DATA\|CLAUDE_PLUGIN_DATA" src/project.js
grep -n "api/atoms'" src/ui/server.js              # the GET list route this plan hooks the sweep into
grep -n "match(/\^\\\\/api\\\\/atoms" src/ui/server.js  # the :id route this plan hooks "seen" into

npm test 2>&1 | tail -6   # baseline pass count
```

---

### Task 1: `resolveDataBase()` + the per-user "seen" ledger

Factoring the per-user data-base path out of `openStore()` avoids a second, independently-drifting copy
of "where does per-user state live" — the exact class of bug the project's own roadmap already recorded
once (`docs/memory/roadmap.md` gap 6: a silent data-directory rename orphaned telemetry).

**Files:**
- Modify: `src/project.js:59` (extract `resolveDataBase`, export it, use it in `openStore`)
- Create: `src/store/seen.js`
- Test: `tests/store/seen.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `resolveDataBase(): string` (exported from `src/project.js`); `readSeen(): Promise<Record<string,string>>`,
  `markSeen(id: string): Promise<void>`, `isSeen(id: string, seen: Record<string,string>): boolean`
  (exported from `src/store/seen.js`) — all three consumed by Task 4

- [ ] **Step 1: Write the failing test**

Create `tests/store/seen.test.js`:

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSeen, markSeen, isSeen } from '../../src/store/seen.js';

async function withDataBase(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dd-seen-'));
  const previous = process.env.CLAUDE_PLUGIN_DATA;
  process.env.CLAUDE_PLUGIN_DATA = dir;
  try { await fn(dir); } finally {
    if (previous === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = previous;
  }
}

describe('per-user seen ledger', () => {
  test('a fresh data base with no seen.json yet reads as empty, not an error', () => withDataBase(async () => {
    assert.deepEqual(await readSeen(), {});
  }));

  test('marking an id seen persists it, and marking it again does not change the timestamp', () => withDataBase(async () => {
    await markSeen('atom-1');
    const first = await readSeen();
    assert.ok(first['atom-1']);
    await markSeen('atom-1');
    const second = await readSeen();
    assert.equal(second['atom-1'], first['atom-1']);
  }));

  test('isSeen reflects the ledger', () => withDataBase(async () => {
    await markSeen('atom-2');
    const seen = await readSeen();
    assert.equal(isSeen('atom-2', seen), true);
    assert.equal(isSeen('atom-3', seen), false);
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/store/seen.test.js`
Expected: FAIL — `src/store/seen.js` doesn't exist yet.

- [ ] **Step 3: Extract `resolveDataBase()` in `src/project.js`**

Replace the `dataBase` line at `src/project.js:59` and its surrounding context:

```js
// Deliberately not `~/.dd`: that made the per-user cache indistinguishable
// from a project marker, so the home resolved as a project root.
export function resolveDataBase() {
  return process.env.GROK_PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || join(homedir(), '.dd-data');
}
```

And in `openStore`, replace the inline computation with a call to it:

```js
const dataBase = resolveDataBase();
const dataDir = process.env.DD_DATA || join(dataBase, `${slug}-${identity}`);
```

(`homedir` and `join` are already imported at the top of `src/project.js` — no new imports needed for
this step.)

- [ ] **Step 4: Write `src/store/seen.js`**

```js
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveDataBase } from '../project.js';

function seenPath() {
  return join(resolveDataBase(), 'seen.json');
}

export async function readSeen() {
  try {
    return JSON.parse(await readFile(seenPath(), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

export async function markSeen(id) {
  const seen = await readSeen();
  if (seen[id]) return;
  seen[id] = new Date().toISOString();
  await mkdir(resolveDataBase(), { recursive: true });
  await writeFile(seenPath(), JSON.stringify(seen), 'utf8');
}

export function isSeen(id, seen) {
  return Boolean(seen[id]);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/store/seen.test.js`
Expected: PASS, 3/3

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: same pass count as "Start here" baseline, plus 3 (nothing else imports the changed
`src/project.js` line differently — `openStore`'s external behavior is unchanged, only its internals
moved).

- [ ] **Step 7: Commit**

```bash
git add src/project.js src/store/seen.js tests/store/seen.test.js
git commit -m "feat: extract resolveDataBase(), add the per-user seen ledger"
```

---

### Task 2: `auto_accept` config default + HTTP config routes

**Files:**
- Modify: `src/store/paths.js` (add `auto_accept` to `DEFAULT_CONFIG`)
- Modify: `src/ui/server.js` (two new routes)
- Test: `tests/ui/server.test.js` (extend — same file the existing HTTP-level tests for this server live in)

**Interfaces:**
- Consumes: `store.loadConfig()` / `store.saveConfig()` (already exist, unchanged signatures)
- Produces: `GET /api/config` → `{ auto_accept: { enabled: boolean, confidence_threshold: number } }`;
  `POST /api/config/auto-accept` with body `{ enabled, confidence_threshold }` → same shape, 200, or 400
  on an invalid threshold — consumed by Task 5 (settings panel) and exercised by Task 3's sweep reading
  `store.loadConfig()` directly (no HTTP involved there, it's the same process)

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/server.test.js` (it already imports `createMemoryStore`, `startUiServer`, and has the
`json()`/`reviewHeaders()` helpers at the top of the file — reuse both, no new imports needed):

```js
describe('auto-accept config', () => {
  test('defaults to disabled, round-trips a valid update, rejects an out-of-range threshold', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-config-'));
    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const base = ui.url;
    const headers = await reviewHeaders(base);

    const initial = await json(base + '/api/config');
    assert.deepEqual(initial.body.auto_accept, { enabled: false, confidence_threshold: 0.8 });

    const updated = await json(base + '/api/config/auto-accept', { method: 'POST', headers,
      body: JSON.stringify({ enabled: true, confidence_threshold: 0.6 }) });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.body.auto_accept, { enabled: true, confidence_threshold: 0.6 });
    assert.deepEqual((await json(base + '/api/config')).body.auto_accept, { enabled: true, confidence_threshold: 0.6 });

    const invalid = await json(base + '/api/config/auto-accept', { method: 'POST', headers,
      body: JSON.stringify({ enabled: true, confidence_threshold: 1.5 }) });
    assert.equal(invalid.status, 409);
  });
});
```

(409, not 400: every thrown error in this file's request handler becomes 409 via the single `catch (err)
{ send(res, 409, { error: err.message }); }` at the end of `startUiServer` — confirmed the same pattern
already exists for `/api/feedback/review`'s `accepted_boolean_required` throw. This task's validation
follows that exact convention, not a new one.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ui/server.test.js`
Expected: FAIL — `/api/config` and `/api/config/auto-accept` are both 404 today.

- [ ] **Step 3: Add the default to `DEFAULT_CONFIG`**

In `src/store/paths.js`, inside the `DEFAULT_CONFIG` object (next to the existing `auto_admit` block —
do not modify `auto_admit`, it stays as-is, unused):

```js
  auto_accept: { enabled: false, confidence_threshold: 0.8 },
```

- [ ] **Step 4: Add the two routes in `src/ui/server.js`**

Add immediately after the existing `/api/feedback/review` block (right before the `/api/atoms` GET
route, so both are grouped with the other `/api/*` handlers):

```js
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const config = await store.loadConfig();
        return send(res, 200, { auto_accept: config.auto_accept });
      }
      if (req.method === 'POST' && url.pathname === '/api/config/auto-accept') {
        const body = await readBody(req);
        if (typeof body.enabled !== 'boolean') throw new Error('enabled_boolean_required');
        if (typeof body.confidence_threshold !== 'number' || body.confidence_threshold < 0 || body.confidence_threshold > 1) {
          throw new Error('confidence_threshold_must_be_0_to_1');
        }
        const config = await store.loadConfig();
        config.auto_accept = { enabled: body.enabled, confidence_threshold: body.confidence_threshold };
        await store.saveConfig(config);
        return send(res, 200, { auto_accept: config.auto_accept });
      }
```

(The single `catch (err) { send(res, 409, { error: err.message }); }` at `src/ui/server.js:123` already
catches every thrown error in this file — confirmed the identical pattern already exists for
`/api/feedback/review`'s `if (typeof body.accepted !== 'boolean') throw new Error('accepted_boolean_required')`
at line 75. A thrown `Error` here becomes 409 the same way; no special-casing needed.)

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test tests/ui/server.test.js`
Expected: PASS, all tests in the file including the new one.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: same count as Task 1's ending count, plus 1.

- [ ] **Step 7: Commit**

```bash
git add src/store/paths.js src/ui/server.js tests/ui/server.test.js
git commit -m "feat: add auto_accept config default and GET/POST /api/config routes"
```

---

### Task 3: `sweepAutoAccept` and wiring it into the UI server

**Files:**
- Create: `src/engine/auto-accept.js`
- Modify: `src/ui/server.js` (call the sweep at startup and on every `GET /api/atoms`)
- Test: `tests/engine/auto-accept.test.js`

**Interfaces:**
- Consumes: `admitMemory`, `HUMAN_REVIEW` from `src/engine/lifecycle.js`; `verifyReferences` from
  `src/engine/evidence.js`; `cappedConfidence` from `src/engine/reliability.js`; `store.loadConfig()`,
  `store.listAtoms({projectId, lifecycleStates})` — all existing, unchanged signatures
- Produces: `sweepAutoAccept({ store, projectId }): Promise<{ admitted: string[] }>` — consumed by
  `src/ui/server.js` in this same task; no other task depends on its return shape

- [ ] **Step 1: Write the failing test**

Create `tests/engine/auto-accept.test.js`. **`candidate.confidence` at proposal time is a constant**
(0.45 for a `model_initiated` proposal — see the note above and `src/engine/contract.js:53` /
`src/engine/reliability.js`; evidence isn't verified until review, so the stored value never reflects
evidence quality). To get a *meaningfully different* confidence between two candidates in a test, vary
whether the evidence actually verifies: a `file`-type ref pointing at a real repo file verifies as
`filesystem` (cap 0.85 × 0.9 = 0.765); the same ref pointing at a path that doesn't exist stays
`unverified`/`agent_claim` (cap 0.5 × 0.9 = 0.45) — `sweepAutoAccept` computes this projected number
itself, exactly like `admitMemory` does internally.

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { proposeMemory } from '../../src/engine/write.js';
import { sweepAutoAccept } from '../../src/engine/auto-accept.js';

async function fixtureStore() {
  const root = await mkdtemp(join(tmpdir(), 'dd-auto-accept-'));
  return createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
}

function proposal(overrides = {}) {
  return {
    project_id: 'demo', capture_origin: 'model_initiated', memory_type: 'lesson',
    title: 'Require trigger', trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first', what: 'Durable memory needs a trigger.', why: 'Stops V1 dumps.',
    topic_key: 'memory/admission/required-fields',
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'gate' }],
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    ...overrides,
  };
}

describe('sweepAutoAccept', () => {
  test('disabled config admits nothing', async () => {
    const store = await fixtureStore();
    const { atom } = await proposeMemory(proposal(), { store });
    const result = await sweepAutoAccept({ store, projectId: 'demo' });
    assert.deepEqual(result.admitted, []);
    assert.equal((await store.getAtom(atom.id, 'demo')).lifecycle_state, 'candidate');
    store.close();
  });

  test('enabled config admits a candidate with real verified evidence, leaves an unverifiable one untouched', async () => {
    const store = await fixtureStore();
    const config = await store.loadConfig();
    // Between the two projected confidence values described above (0.765 verified, 0.45 unverifiable).
    config.auto_accept = { enabled: true, confidence_threshold: 0.6 };
    await store.saveConfig(config);

    const { atom: verified } = await proposeMemory(proposal({ topic_key: 'memory/admission/topic-a',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'gate' }] }), { store });
    const { atom: unverifiable } = await proposeMemory(proposal({ topic_key: 'memory/admission/topic-b',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/does-not-exist.js', summary: 'gate' }] }), { store });

    const result = await sweepAutoAccept({ store, projectId: 'demo' });
    assert.ok(result.admitted.includes(verified.id));
    assert.equal((await store.getAtom(verified.id, 'demo')).lifecycle_state, 'active');
    assert.ok(!result.admitted.includes(unverifiable.id));
    assert.equal((await store.getAtom(unverifiable.id, 'demo')).lifecycle_state, 'candidate');
    store.close();
  });

  test('a candidate admitMemory rejects (stale replacement target) stays a candidate, not an error', async () => {
    const store = await fixtureStore();
    // Go through the real proposeMemory pipeline first, so the atom already
    // satisfies decideAdmission's structural gate (valid evidence_refs, minimum
    // retrieval_forms, etc.) exactly as production-shaped data would -- then
    // overwrite just `replaces` directly, the one field this test needs to
    // control, via the same store.putAtom other tests in this codebase already
    // use for direct fixture construction (see tests/hooks/codex.test.js).
    const { atom } = await proposeMemory(proposal({ topic_key: 'memory/admission/stale-replacement' }), { store });
    await store.putAtom({ ...atom, replaces: 'does-not-exist' });

    const config = await store.loadConfig();
    config.auto_accept = { enabled: true, confidence_threshold: 0 };
    await store.saveConfig(config);
    const result = await sweepAutoAccept({ store, projectId: 'demo' });
    // admitMemory's replacement_changed_review_again throw fires here: `replaces`
    // names an atom that doesn't exist, so it can't be active/contested.
    assert.ok(!result.admitted.includes(atom.id));
    assert.equal((await store.getAtom(atom.id, 'demo')).lifecycle_state, 'candidate');
    store.close();
  });

  test('rationale names the projected confidence and threshold', async () => {
    const store = await fixtureStore();
    const { atom } = await proposeMemory(proposal(), { store }); // real, verifiable evidence_ref -> 0.765
    const config = await store.loadConfig();
    config.auto_accept = { enabled: true, confidence_threshold: 0 };
    await store.saveConfig(config);
    await sweepAutoAccept({ store, projectId: 'demo' });
    // admitMemory stamps the rationale onto the approved atom's `review.rationale`
    // field (src/engine/lifecycle.js:47) -- read it back from there directly.
    const admitted = await store.getAtom(atom.id, 'demo');
    assert.equal(admitted.lifecycle_state, 'active');
    assert.equal(admitted.review.rationale, 'Auto-accepted: confidence 0.765 >= threshold 0.');
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/engine/auto-accept.test.js`
Expected: FAIL — `src/engine/auto-accept.js` doesn't exist yet.

- [ ] **Step 3: Write `src/engine/auto-accept.js`**

```js
import { admitMemory, HUMAN_REVIEW } from './lifecycle.js';
import { verifyReferences } from './evidence.js';
import { cappedConfidence } from './reliability.js';

export async function sweepAutoAccept({ store, projectId }) {
  const config = await store.loadConfig();
  if (!config.auto_accept?.enabled) return { admitted: [] };
  const threshold = config.auto_accept.confidence_threshold;
  const candidates = await store.listAtoms({ projectId, lifecycleStates: ['candidate'] });
  const admitted = [];
  for (const candidate of candidates) {
    // candidate.confidence (stamped at proposal time) is not usable here -- it's
    // a constant, since evidence isn't verified until review. Compute the real,
    // evidence-based projection ourselves: the same two calls admitMemory makes
    // internally to produce the number it actually stamps.
    const evidence_state = await verifyReferences(candidate.evidence_refs, { store, projectId });
    const projectedConfidence = cappedConfidence({ ...candidate, evidence_state }, { authority: 'validated' });
    if (projectedConfidence < threshold) continue;
    try {
      await admitMemory(candidate.id, {
        store, projectId, actor: HUMAN_REVIEW,
        rationale: `Auto-accepted: confidence ${projectedConfidence} >= threshold ${threshold}.`,
      });
      admitted.push(candidate.id);
    } catch {
      // Anything admitMemory itself refuses (collision, stale replacement
      // target, evidence re-verification failure, missing rationale -- none
      // apply here since a rationale is always supplied above, but any future
      // admitMemory check applies too) leaves the candidate exactly where a
      // human reviewer would find it. This is the only place this function
      // makes a decision; everything else is admitMemory's existing logic.
    }
  }
  return { admitted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/engine/auto-accept.test.js`
Expected: PASS, 4/4. If test 2 or test 4's exact numbers (0.765, 0.45) don't match, print the actual
`projectedConfidence`/`admitted.review.rationale` values and adjust the test's expected numbers to match
reality — the exact figures depend on `RELIABILITY_CAP`/`CAPTURE_ORIGIN_FACTOR`'s current values
(`src/engine/reliability.js`), which this task does not change; don't hand-tune the source to hit a
pre-guessed number.

- [ ] **Step 5: Wire the sweep into `src/ui/server.js`**

In `startUiServer`, call it once right after the function's existing setup (before `createServer` runs,
or immediately after — anywhere that runs once per server start, with `store`/`projectId` already in
scope):

```js
  await sweepAutoAccept({ store, projectId });
```

And inside the existing `GET /api/atoms` handler (the block currently reading `const lifecycle = url.searchParams.get('lifecycle')`), add the sweep as the first line of that block, before `store.listAtoms` runs:

```js
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        await sweepAutoAccept({ store, projectId });
        const lifecycle = url.searchParams.get('lifecycle');
        // ...unchanged below
```

Add the import at the top of `src/ui/server.js`:

```js
import { sweepAutoAccept } from '../engine/auto-accept.js';
```

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: same count as Task 2's ending count, plus 4. Also re-run `tests/ui/server.test.js` specifically
to confirm the existing "local review approves candidates" test still passes with the sweep now running
on every `GET /api/atoms` call it makes (it should be a no-op there, since that test's project never
enables `auto_accept`).

- [ ] **Step 7: Commit**

```bash
git add src/engine/auto-accept.js src/ui/server.js tests/engine/auto-accept.test.js
git commit -m "feat: add sweepAutoAccept, run it at UI startup and on every atom list fetch"
```

---

### Task 4: Wire the "seen" ledger into the atom routes

**Files:**
- Modify: `src/ui/server.js` (the `GET /api/atoms` list handler from Task 3, and the `GET /api/atoms/:id` detail handler)
- Test: `tests/ui/server.test.js` (extend)

**Interfaces:**
- Consumes: `readSeen`, `markSeen`, `isSeen` from `src/store/seen.js` (Task 1)
- Produces: every atom object returned by `GET /api/atoms` and `GET /api/atoms/:id` gains a `seen: boolean`
  field — consumed by Task 5's pulsing-dot indicator

- [ ] **Step 1: Write the failing test**

Add to `tests/ui/server.test.js`:

```js
describe('seen tracking', () => {
  test('a candidate is unseen until its detail view is fetched, and stays seen after', async t => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-seen-'));
    const dataDir = await mkdtemp(join(tmpdir(), 'dd-seen-userdata-'));
    const previous = process.env.CLAUDE_PLUGIN_DATA;
    process.env.CLAUDE_PLUGIN_DATA = dataDir;
    t.after(() => { if (previous === undefined) delete process.env.CLAUDE_PLUGIN_DATA; else process.env.CLAUDE_PLUGIN_DATA = previous; });

    const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
    const written = await proposeMemory({
      project_id: 'demo', capture_origin: 'model_initiated', memory_type: 'lesson',
      title: 'Require trigger', trigger: 'before writing durable memory', behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.', why: 'Stops V1 dumps.', topic_key: 'memory/admission/required-fields',
      evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'gate' }],
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    }, { store });
    const ui = await startUiServer({ store, projectId: 'demo', port: 0 });
    t.after(async () => { await ui.close(); store.close(); });
    const base = ui.url;
    const headers = await reviewHeaders(base);

    const beforeList = await json(base + '/api/atoms');
    assert.equal(beforeList.body[0].seen, false);

    const detail = await json(base + '/api/atoms/' + written.atom.id, { headers });
    assert.equal(detail.body.seen, true);

    const afterList = await json(base + '/api/atoms');
    assert.equal(afterList.body[0].seen, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/ui/server.test.js`
Expected: FAIL — `seen` is `undefined` on both responses today.

- [ ] **Step 3: Wire it into `src/ui/server.js`**

Add the import:

```js
import { readSeen, markSeen, isSeen } from '../store/seen.js';
```

In the `GET /api/atoms` handler (already modified by Task 3), annotate the response:

```js
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        await sweepAutoAccept({ store, projectId });
        const lifecycle = url.searchParams.get('lifecycle');
        const origin = url.searchParams.get('capture_origin');
        const atoms = await store.listAtoms({ projectId, lifecycleStates: lifecycle ? [lifecycle] : undefined });
        const seen = await readSeen();
        return send(res, 200, atoms.filter(atom => !origin || atom.capture_origin === origin)
          .map(atom => ({ ...atom, seen: isSeen(atom.id, seen) })));
      }
```

In the `GET` branch of the `/api/atoms/:id` match block (the block starting with `if (req.method === 'GET')`,
right where `relations` is computed), mark it seen and include the field in the response:

```js
        if (req.method === 'GET') {
          await markSeen(atom.id);
          const relations = await store.listRelations({ atomIds: [atom.id] });
          const ids = relations.filter(r => r.relation_type === 'contradicts')
            .map(r => r.source_atom_id === atom.id ? r.target_atom_id : r.source_atom_id);
          const opponents = (await Promise.all(ids.map(peerId => store.getAtom(peerId, projectId))))
            .filter(a => a && ['active', 'contested'].includes(a.lifecycle_state))
            .map(a => ({ id: a.id, title: a.title, topic_key: a.topic_key,
              recommendation: recommendResolution(atom, a) }));
          return send(res, 200, { ...atom, seen: true, freshness: await checkEvidenceFreshness(atom, store), relations, opponents });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/ui/server.test.js`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: same count as Task 3's ending count, plus 1.

- [ ] **Step 6: Commit**

```bash
git add src/ui/server.js tests/ui/server.test.js
git commit -m "feat: annotate atom responses with per-user seen state"
```

---

### Task 5: UI — filters, sort, pulsing-dot indicator, settings panel

The real file (`src/ui/public/index.html`, 268 lines) has: an `api(path, opts)` helper (line 82-87) that
already attaches the `x-dd-review-token` header to every call — every new fetch in this task uses `api(...)`,
never a bare `fetch(...)`; a module-scope `let atoms = []` (line 79) populated by `load()` (line 89-109);
`renderList()` (line 125-133) building each `.item` row; and existing filter selects `#filter` / `#origin-filter`
(lines 47-60) inside `<nav>` (line 46-62), read via `filterEl` / `originFilterEl` (lines 77-78) and wired with
`filterEl.addEventListener('change', load)` (line 259-260).

**Files:**
- Modify: `src/ui/public/index.html`
- Modify: `src/ui/server.js` (the `GET /api/atoms` handler gains a `memory_type` query param)
- Test: manual — `tests/ui/server.test.js`'s existing `new Script(...)` syntax-check of every inline
  `<script>` block (line 58) already runs whenever that test fetches `/`; it catches a JS syntax error,
  not a behavioral one, but confirms this task's markup doesn't break page load

**Interfaces:**
- Consumes: `GET /api/atoms` (now returns `seen: boolean` per atom, Task 4), `GET /api/config` /
  `POST /api/config/auto-accept` (Task 2)
- Produces: nothing consumed by another task — this is the leaf of the dependency chain

- [ ] **Step 1: Add `memory_type` filtering to `GET /api/atoms`**

In `src/ui/server.js`, the handler Task 4 left looking like this:

```js
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        await sweepAutoAccept({ store, projectId });
        const lifecycle = url.searchParams.get('lifecycle');
        const origin = url.searchParams.get('capture_origin');
        const atoms = await store.listAtoms({ projectId, lifecycleStates: lifecycle ? [lifecycle] : undefined });
        const seen = await readSeen();
        return send(res, 200, atoms.filter(atom => !origin || atom.capture_origin === origin)
          .map(atom => ({ ...atom, seen: isSeen(atom.id, seen) })));
      }
```

Add a `memory_type` param and filter:

```js
      if (req.method === 'GET' && url.pathname === '/api/atoms') {
        await sweepAutoAccept({ store, projectId });
        const lifecycle = url.searchParams.get('lifecycle');
        const origin = url.searchParams.get('capture_origin');
        const memoryType = url.searchParams.get('memory_type');
        const atoms = await store.listAtoms({ projectId, lifecycleStates: lifecycle ? [lifecycle] : undefined });
        const seen = await readSeen();
        return send(res, 200, atoms.filter(atom => !origin || atom.capture_origin === origin)
          .filter(atom => !memoryType || atom.memory_type === memoryType)
          .map(atom => ({ ...atom, seen: isSeen(atom.id, seen) })));
      }
```

- [ ] **Step 2: Add the new filter bar controls**

In `src/ui/public/index.html`, inside `<nav>` (line 46-62), right after the closing `</select>` of
`#origin-filter` (line 60) and before `<button id="reload">Reload</button>` (line 61):

```html
      <select id="type-filter" aria-label="Memory type">
        <option value="">all types</option>
        <option value="lesson">lesson</option>
        <option value="anti_memory">anti-memory</option>
        <option value="procedure">procedure</option>
        <option value="decision">decision</option>
        <option value="claim">claim</option>
      </select>
      <label><input type="checkbox" id="unseen-only"> unseen only</label>
      <select id="sort-by" aria-label="Sort by">
        <option value="created_at">newest first</option>
        <option value="confidence">confidence</option>
        <option value="activation_count">most activated</option>
      </select>
```

- [ ] **Step 3: Add the settings panel**

Right after `<div id="project"></div>` (line 64) and before the `<details id="evidence">` block (line 65):

```html
  <details id="auto-accept-settings">
    <summary>Auto-accept settings</summary>
    <label><input type="checkbox" id="auto-accept-enabled"> Auto-accept high-confidence candidates</label>
    <label>Confidence threshold <input type="number" id="auto-accept-threshold" min="0" max="1" step="0.05"></label>
  </details>
```

- [ ] **Step 4: Wire the new controls into the script**

Next to the existing element lookups (line 77-78, `const filterEl = ...` / `const originFilterEl = ...`):

```js
    const typeFilterEl = document.getElementById('type-filter');
    const unseenOnlyEl = document.getElementById('unseen-only');
    const sortByEl = document.getElementById('sort-by');
    const autoAcceptEnabledEl = document.getElementById('auto-accept-enabled');
    const autoAcceptThresholdEl = document.getElementById('auto-accept-threshold');
```

Inside `load()` (line 89-109), the existing query-param block is:

```js
      const q = new URLSearchParams();
      if (filterEl.value) q.set('lifecycle', filterEl.value);
      if (originFilterEl.value) q.set('capture_origin', originFilterEl.value);
      await loadEvidence();
      atoms = await api('/api/atoms?' + q);
      renderList();
```

Replace with:

```js
      const q = new URLSearchParams();
      if (filterEl.value) q.set('lifecycle', filterEl.value);
      if (originFilterEl.value) q.set('capture_origin', originFilterEl.value);
      if (typeFilterEl.value) q.set('memory_type', typeFilterEl.value);
      await loadEvidence();
      atoms = await api('/api/atoms?' + q);
      if (unseenOnlyEl.checked) atoms = atoms.filter(a => !a.seen);
      const sortKey = sortByEl.value;
      atoms = atoms.slice().sort((a, b) => sortKey === 'created_at'
        ? new Date(b.created_at) - new Date(a.created_at) : (b[sortKey] ?? 0) - (a[sortKey] ?? 0));
      renderList();
```

Add a settings load/save pair, called once at the bottom of the script next to the existing `load();`
call (line 265):

```js
    async function loadAutoAcceptConfig() {
      const { auto_accept } = await api('/api/config');
      autoAcceptEnabledEl.checked = auto_accept.enabled;
      autoAcceptThresholdEl.value = auto_accept.confidence_threshold;
    }
    async function saveAutoAcceptConfig() {
      await api('/api/config/auto-accept', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: autoAcceptEnabledEl.checked, confidence_threshold: Number(autoAcceptThresholdEl.value) }) });
    }
    autoAcceptEnabledEl.addEventListener('change', saveAutoAcceptConfig);
    autoAcceptThresholdEl.addEventListener('change', saveAutoAcceptConfig);
```

Register the three new list-affecting listeners next to the existing ones (line 259-260,
`filterEl.addEventListener('change', load); originFilterEl.addEventListener('change', load);`):

```js
    typeFilterEl.addEventListener('change', load);
    unseenOnlyEl.addEventListener('change', load);
    sortByEl.addEventListener('change', load);
```

And change the last two lines of the script (line 265, `load();`) to also load settings on page open:

```js
    load();
    loadAutoAcceptConfig();
```

- [ ] **Step 5: Add the pulsing-dot indicator**

`renderList()` (line 125-133) currently reads:

```js
    function renderList() {
      listEl.innerHTML = atoms.map(atom => `
        <div class="item ${selected && selected.id === atom.id ? 'active' : ''}" data-id="${escapeHtml(atom.id)}">
          <strong>${escapeHtml(atom.title)}</strong>
          <small><span class="badge">${escapeHtml(atom.lifecycle_state)}</span> ${escapeHtml(atom.topic_key)}</small>
          <small>${escapeHtml(captureLabel(atom))}</small>
        </div>
      `).join('');
    }
```

Add the dot before `<strong>`:

```js
    function renderList() {
      listEl.innerHTML = atoms.map(atom => `
        <div class="item ${selected && selected.id === atom.id ? 'active' : ''}" data-id="${escapeHtml(atom.id)}">
          ${atom.seen ? '' : '<span class="unseen-dot" aria-label="not yet reviewed"></span>'}<strong>${escapeHtml(atom.title)}</strong>
          <small><span class="badge">${escapeHtml(atom.lifecycle_state)}</span> ${escapeHtml(atom.topic_key)}</small>
          <small>${escapeHtml(captureLabel(atom))}</small>
        </div>
      `).join('');
    }
```

Add to the `<style>` block, next to the existing `.badge` rule (line 29):

```css
    .unseen-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--acc); margin-right: 6px; animation: dd-pulse 1.6s ease-in-out infinite; }
    @keyframes dd-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.4); } }
```

(`var(--acc)` reuses the existing accent color token already declared in `:root`, line 9 — no new color
introduced.)

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: same count as Task 4's ending count (no new automated test here, but `tests/ui/server.test.js`'s
existing page-load/script-syntax check, and every test exercising `/api/atoms`, must still pass with the
`memory_type` param added).

- [ ] **Step 7: Manual verification**

Start the UI against a project with a few candidates at different confidence levels and memory types.
Confirm: the type filter narrows the list, "unseen only" hides rows once their detail view has been
opened, the sort options reorder the list, the pulsing dot appears only on unseen rows and disappears
after opening a memory's detail, and the settings panel loads the current config on page open and
persists a change to `.dd/config.json` (`POST /api/config/auto-accept` succeeding, `GET /api/config`
reflecting it back correctly).

- [ ] **Step 8: Commit**

```bash
git add src/ui/public/index.html src/ui/server.js
git commit -m "feat: add type/unseen filters, sort, pulsing-dot indicator, auto-accept settings panel"
```

---

### Task 6: Close out

- [ ] **Step 1: Full suite**

```bash
npm test
```

Expected: same count as Task 5's ending count (Task 5 added no new automated tests).

- [ ] **Step 2: Eval gate — confirm zero drift**

```bash
npm run eval
```

Expected: identical f1/exact numbers to this plan's "Start here" baseline. Any difference means scope
crept into retrieval/ranking code, which no task in this plan should have touched — if it changed,
find which task's diff is responsible before proceeding.

- [ ] **Step 3: Commit**

```bash
git add -A
git status --porcelain   # confirm nothing unexpected is staged before committing
git commit -m "chore: auto-accept memories feature complete"
```
