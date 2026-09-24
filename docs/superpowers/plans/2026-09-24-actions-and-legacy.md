# Actions, Legacy and Memory Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent file reviewable store operations (actions), add the `legacy` lifecycle state that warns the agent off abandoned practices, let the reviewer request revisions with a reason, and ship `/dd:*` commands that drive memory management from chat.

**Architecture:** Actions are pending JSON files in `.dd/actions/`, filed by a new MCP tool `act` and applied only by the audit UI through `src/engine/actions.js`, in one store transaction with a snapshot check. `legacy` is a stored state with its own directory, recalled beside `active`/`contested` and dropped from a pack when current guidance on the same ground is present. Revision requests are fields on pending items, delivered to the model by the prompt and session-start hooks. Commands are skills.

**Tech Stack:** Node ≥ 22 ESM, `node:test`, `node:sqlite`, `@modelcontextprotocol/sdk`, `zod`. No new dependency.

**Spec:** `docs/superpowers/specs/2026-09-24-actions-and-legacy-design.md`

## Global Constraints

- DD is a plugin: read `docs/architecture/plugin-constraints.md` (L1–L7). Nothing new runs in `PreToolUse` except legacy atoms joining the existing candidate set.
- Model output never mutates state: `act` and `propose` only write pending files. Only `HUMAN_REVIEW` (`src/engine/lifecycle.js`) applies, rejects or revises.
- Actions are never auto-accepted; `src/engine/auto-accept.js` reads candidates only.
- Everything in the repository is written in English (code, comments, docs, skills, memory text).
- `npm test`, `npm run test:stress` and `npm run eval` (f1 ≥ 0.9, exact ≥ 90%) pass at the end of every task that touches `src/`.
- Files under `src/` may use CRLF; edit them with the Edit tool, not with generated JS string replacement.
- After editing `src/` in a live session, restart the resident: `echo '{"cwd":"C:/dev/supermem","session_id":"restart","source":"startup"}' | node hooks/run.cjs session-start`.
- Commit after each task with a Conventional Commits message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. An index built by 0.3.x (old CHECK without `legacy`) must migrate on open without losing `activation_count`; test in Task 1.
2. A merge whose result topic is held by a memory outside the merge must refuse and change nothing; test in Task 5.
3. A candidate with an open revision request must not be admitted by the auto-accept sweep; test in Task 6.
4. A legacy memory whose `replaced_by` points at a memory that is no longer effective is still recalled (nothing current covers it); test in Task 3.
5. An action filed against an id that does not exist in this project is refused at filing, not at apply; test in Task 4.

---

## File map

| File | Responsibility |
|---|---|
| `src/store/paths.js` | `legacyFilePath`, `actionFilePath`, state lists, `archive_review_at` default |
| `src/store/schema.sql`, `src/store/sqlite-index.js` | `legacy` in CHECK, migration, `memory_action_log` |
| `src/store/git-file-store.js` | legacy placement, action files, action writes inside `commit` |
| `src/store/create-store.js` | index format 7.3, action API, `logAction`, watcher/fingerprint dirs |
| `src/store/fingerprint.js` | `legacy/` in the fingerprint |
| `src/engine/lifecycle.js` | readable `archived_reason`, restore from legacy, admit refuses revision-requested |
| `src/engine/retrieve.js`, `src/hooks/session-start.js` (`microPack`), `src/semantic/*` | legacy recall, LEGACY flag, legacy vectors, `similar` |
| `src/engine/actions.js` (new) | file, validate, snapshot, apply, reject, revise actions |
| `src/engine/revisions.js` (new) | revision requests on candidates and actions; notices for hooks |
| `src/engine/write.js` | `revises` on proposals |
| `src/mcp/definition.js`, `src/mcp/tools.js` | `act`, `similar`, `revises`, status fields |
| `src/hooks/run.js`, `src/hooks/bridge.js`, `src/ui/server.js` | revision notices, `similar` bridge, action/revise routes |
| `src/ui/public/index.html` | Actions panel, revise buttons, legacy chip, reasons |
| `skills/*`, `.claude-plugin/*`, `scripts/install-codex.mjs` | commands and the `dd` plugin name |
| `docs/DD.md`, `README.md`, `docs/architecture/invariants.md` | contract |

---

### Task 1: Store — legacy state, action files, action log, index migration

**Files:**
- Modify: `src/store/paths.js`, `src/store/schema.sql`, `src/store/sqlite-index.js`, `src/store/git-file-store.js`, `src/store/create-store.js`, `src/store/fingerprint.js`
- Test: `tests/store/legacy-and-actions.test.js` (new)

**Interfaces:**
- Produces: `legacyFilePath(ddDir, id)`, `actionFilePath(ddDir, id)`, `EFFECTIVE_STATES = ['active','contested']`, `RECALL_STATES = ['active','contested','legacy']`; store methods `listActions(projectId) → action[]`, `getAction(id) → action|null`, `putAction(action) → action`, `commitAtoms(atoms, newRelations = [], deleteAtoms = [], actionWrites = [])` where `actionWrites` is `[{ id, value: action|null }]`, `logAction({ project_id, action_id, kind, targets, outcome, note, actor_ref })`, `listActionLog(projectId) → rows`.

- [ ] **Step 1: Write the failing tests**

```js
// tests/store/legacy-and-actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project', title: `T ${id}`,
  trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated',
  confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [],
  trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: 'active', ...extra });

async function fresh() {
  const root = await mkdtemp(join(tmpdir(), 'dd-legacy-'));
  const options = { ddDir: join(root, '.dd'), dataDir: join(root, 'data') };
  return { root, options, store: await createMemoryStore(options) };
}

test('a legacy memory is stored by id under legacy/ and indexed', async t => {
  const { root, store } = await fresh();
  t.after(() => store.close());
  await store.putAtom(atom('a1', { lifecycle_state: 'legacy', legacy_reason: 'Replaced by the resident.', legacy_at: '2026-09-24T00:00:00.000Z' }));
  await access(join(root, '.dd', 'legacy', 'a1.json'));
  assert.equal((await store.getAtom('a1', 'demo')).lifecycle_state, 'legacy');
  assert.equal((await store.listAtoms({ projectId: 'demo', lifecycleStates: ['legacy'] })).length, 1);
});

test('an action and the atoms it changes are written in one commit', async t => {
  const { root, store } = await fresh();
  t.after(() => store.close());
  await store.putAtom(atom('a2'));
  await store.putAction({ id: 'act1', project_id: 'demo', kind: 'archive', targets: ['a2'], status: 'pending' });
  assert.equal((await store.listActions('demo')).length, 1);
  await store.commitAtoms([{ ...(await store.getAtom('a2', 'demo')), lifecycle_state: 'archived', archived_reason: 'Unused.' }], [], [],
    [{ id: 'act1', value: null }]);
  assert.equal(await store.getAction('act1'), null);
  await assert.rejects(access(join(root, '.dd', 'actions', 'act1.json')));
  await store.logAction({ project_id: 'demo', action_id: 'act1', kind: 'archive', targets: ['a2'], outcome: 'applied', actor_ref: 'local_ui' });
  assert.equal((await store.listActionLog('demo'))[0].outcome, 'applied');
});

test('an index built before legacy existed is migrated without losing activation counts', async t => {
  const { options, store } = await fresh();
  await store.putAtom(atom('a3'));
  store.index.db.prepare('UPDATE memory_atoms SET activation_count = 7 WHERE id = ?').run('a3');
  const file = join(options.dataDir, 'index.sqlite');
  store.close();
  // Recreate the 0.3.x table: the old CHECK without 'legacy'.
  const db = new DatabaseSync(file);
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'memory_atoms'").get().sql.replace(",'legacy'", '');
  db.exec(`DROP INDEX IF EXISTS uq_memory_atoms_project_topic_effective; DROP INDEX IF EXISTS idx_memory_atoms_project_lifecycle;
    ALTER TABLE memory_atoms RENAME TO old_atoms; ${sql}; INSERT INTO memory_atoms SELECT * FROM old_atoms; DROP TABLE old_atoms;`);
  db.close();
  const reopened = await createMemoryStore(options);
  t.after(() => reopened.close());
  await reopened.putAtom(atom('a4', { lifecycle_state: 'legacy', legacy_reason: 'Old way.' }));
  assert.equal(reopened.index.db.prepare('SELECT activation_count FROM memory_atoms WHERE id = ?').get('a3').activation_count, 7);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/store/legacy-and-actions.test.js`
Expected: FAIL (`putAction` is not a function; CHECK constraint failed for `legacy`).

- [ ] **Step 3: Implement**

`src/store/paths.js` — after `ARCHIVE_STATES`:

```js
export const EFFECTIVE_STATES = ['active', 'contested'];
// Legacy knowledge is recalled as a warning; see src/engine/retrieve.js.
export const RECALL_STATES = ['active', 'contested', 'legacy'];

export function legacyFilePath(ddDir, id) {
  archiveFilePath(ddDir, id);
  return join(ddDir, 'legacy', `${id}.json`);
}

export function actionFilePath(ddDir, id) {
  archiveFilePath(ddDir, id);
  return join(ddDir, 'actions', `${id}.json`);
}
```

and in `DEFAULT_CONFIG` add `archive_review_at: 50,` after `session`.

`src/store/schema.sql` — change the `lifecycle_state` CHECK to
`CHECK (lifecycle_state IN ('candidate','active','contested','superseded','archived','rejected','legacy'))`, and append:

```sql
-- Applied, rejected and revised actions (src/engine/actions.js), retained as audit.
CREATE TABLE IF NOT EXISTS memory_action_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  targets TEXT NOT NULL DEFAULT '[]',
  outcome TEXT NOT NULL CHECK (outcome IN ('applied','rejected','revised','stale')),
  note TEXT,
  actor_ref TEXT,
  created_at TEXT NOT NULL
);
```

`src/store/sqlite-index.js` — replace `migrate`:

```js
  async function migrate() {
    // CREATE TABLE IF NOT EXISTS keeps an older CHECK on an existing table. An
    // index from before `legacy` is rebuilt in place, rows kept (activation
    // counts live only here); its indexes are dropped first so the schema
    // recreates them on the new table rather than following the renamed one.
    const existing = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'memory_atoms'").get();
    const sql = await readFile(SCHEMA_PATH, 'utf8');
    if (existing && !existing.sql.includes("'legacy'")) {
      db.exec(`DROP INDEX IF EXISTS uq_memory_atoms_project_topic_effective;
        DROP INDEX IF EXISTS idx_memory_atoms_project_lifecycle;
        ALTER TABLE memory_atoms RENAME TO memory_atoms_before_legacy;`);
      db.exec(sql);
      db.exec('INSERT INTO memory_atoms SELECT * FROM memory_atoms_before_legacy; DROP TABLE memory_atoms_before_legacy;');
      return;
    }
    db.exec(sql);
  }
```

`src/store/git-file-store.js`:
- import `legacyFilePath, actionFilePath` from `./paths.js`.
- `destination(atom)`: add `if (atom.lifecycle_state === 'legacy') return legacyFilePath(ddDir, atom.id);` before the archive line.
- `readStored`: read `['atoms', 'candidates', 'archive', 'legacy']`.
- `commit({ atoms = [], deleteAtoms = [], relations, actions = [] } = {})`: in the cleanup loop use
  `[atomFilePath(ddDir, atom.topic_key), candidateFilePath(ddDir, atom.id), archiveFilePath(ddDir, atom.id), legacyFilePath(ddDir, atom.id)]`, and before `commitTransaction` add
  `for (const { id, value } of actions) operations.set(rel(actionFilePath(ddDir, id)), value);`
- New functions, returned from the factory:

```js
  async function listActions(projectId) {
    const files = await walk(join(ddDir, 'actions'));
    const actions = await Promise.all(files.map(file => readJson(file, null).catch(() => null)));
    return actions.filter(a => a?.id && (!projectId || a.project_id === projectId))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  }
  const getAction = id => readJson(actionFilePath(ddDir, id), null);
  const putAction = action => withWriteLock(async () => {
    await commitTransaction(ddDir, [{ path: rel(actionFilePath(ddDir, action.id)), value: action }]);
    return action;
  });
```

`src/store/create-store.js`:
- `INDEX_FORMAT = '7.3'` and extend its comment: `7.3: the legacy lifecycle state.`
- watcher regex: `/^(atoms|archive|candidates|legacy|actions|registry)([\\/]|$)|^relations\.json$/`.
- `commitAtoms(atoms, newRelations = [], deleteAtoms = [], actionWrites = [])` passes `actions: actionWrites` to `git.commit`; index upserts for non-effective states already cover `legacy`.
- `logAction` and `listActionLog`, following `logContradiction`:

```js
  async function logAction(entry) {
    index.db.prepare(`INSERT INTO memory_action_log (id, project_id, action_id, kind, targets, outcome, note, actor_ref, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), entry.project_id, entry.action_id, entry.kind,
      JSON.stringify(entry.targets ?? []), entry.outcome, entry.note ?? null, entry.actor_ref ?? null, nowIso());
  }
  async function listActionLog(projectId) {
    return index.db.prepare('SELECT * FROM memory_action_log WHERE project_id = ? ORDER BY created_at DESC').all(projectId)
      .map(row => ({ ...row, targets: JSON.parse(row.targets) }));
  }
```

- return `listActions: git.listActions, getAction: git.getAction, putAction: git.putAction, logAction, listActionLog` from the store.

`src/store/fingerprint.js`: add `...await walkJsonFiles(join(ddDir, 'legacy')),` (actions are not indexed; they stay out).

- [ ] **Step 4: Run tests**

Run: `node --test tests/store/legacy-and-actions.test.js && npm run test:store`
Expected: PASS.

- [ ] **Step 5: Commit** — `feat(store): legacy state, action files and action log`

---

### Task 2: Lifecycle — readable archive reasons, restore from legacy

**Files:**
- Modify: `src/engine/lifecycle.js`
- Test: `tests/engine/forgetting.test.js` (extend), `tests/engine/legacy-lifecycle.test.js` (new)

**Interfaces:**
- Produces: `archiveMemory(id, { store, projectId, reason })` — `reason` required non-empty text, else `archive_reason_required`; `restoreMemory` accepts `archived` or `legacy`; `admitMemory` throws `revision_requested` when `candidate.revision_requested` is set.

- [ ] **Step 1: Failing tests**

```js
// tests/engine/legacy-lifecycle.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { archiveMemory, restoreMemory, admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';
import { proposeMemory } from '../../src/engine/write.js';
import { PROVENANCE } from '../helpers/atom.js';

const base = (id, extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project', title: `T ${id}`,
  trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'inferred', confidence: 0.6,
  valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [], trigger_variants: [],
  assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: 'active', ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-lifecycle-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}

test('archiving needs a readable reason', async t => {
  const s = await store(t);
  await s.putAtom(base('b1'));
  await assert.rejects(archiveMemory('b1', { store: s, projectId: 'demo', reason: '  ' }), /archive_reason_required/);
  const archived = await archiveMemory('b1', { store: s, projectId: 'demo', reason: 'Never activated in 40 retrievals.' });
  assert.equal(archived.archived_reason, 'Never activated in 40 retrievals.');
});

test('a legacy memory is restored like an archived one', async t => {
  const s = await store(t);
  await s.putAtom(base('b2', { lifecycle_state: 'legacy', legacy_reason: 'Old.', legacy_at: '2026-09-24T00:00:00.000Z' }));
  const restored = await restoreMemory('b2', { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
  assert.equal(restored.lifecycle_state, 'active');
  assert.equal(restored.legacy_reason, null);
});

test('a candidate with an open revision request cannot be admitted', async t => {
  const s = await store(t);
  const { atom } = await proposeMemory({ project_id: 'demo', topic_key: 'demo/area/b3', trigger: 'when testing revisions',
    behavior_delta: 'Check revision gating.', why: 'Review asked for changes.', capture_origin: 'model_initiated',
    evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] }, { store: s });
  await s.putAtom({ ...atom, revision_requested: { reason: 'Narrow the scope.', at: '2026-09-24T00:00:00.000Z' } });
  await assert.rejects(admitMemory(atom.id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'ok' }), /revision_requested/);
});
```

In `tests/engine/forgetting.test.js`, add to the existing disuse test an assertion that every archived atom's `archived_reason` matches `/^Never activated in \d+ retrievals since /`.

- [ ] **Step 2: Run** — `node --test tests/engine/legacy-lifecycle.test.js tests/engine/forgetting.test.js` → FAIL.

- [ ] **Step 3: Implement** in `src/engine/lifecycle.js`:

```js
export async function archiveMemory(id, { store, projectId, reason } = {}) {
  if (!String(reason ?? '').trim()) throw new Error('archive_reason_required');
  return store.withWriteLock(async () => {
    const atom = await store.getAtom(id, projectId);
    if (!atom || atom.lifecycle_state !== 'active') throw new Error('active_memory_required');
    if (!['inferred', 'observed'].includes(atom.authority)) throw new Error('authority_protected');
    return store.putAtom({ ...atom, lifecycle_state: 'archived',
      archived_at: new Date().toISOString(), archived_reason: String(reason).trim() });
  });
}
```

`restoreMemory`: accept `['archived', 'legacy'].includes(atom.lifecycle_state)` (error stays `archived_memory_required`), and clear `legacy_reason: null, legacy_at: null, replaced_by: null` along with the archive fields.

`admitMemory`: after the `candidate_required` check add `if (candidate.revision_requested) throw new Error('revision_requested');`.

`retireByDisuse`: pass a readable reason built from the snapshot row the sweep already has:

```js
    const reason = `Never activated in ${atom.retrievals_since ?? 'enough'} retrievals since ${String(atom.created_at).slice(0, 10)}.`;
    try { archived.push((await archiveMemory(atom.id, { store, projectId, reason })).id); } catch { /* left effective */ }
```

(Check `retirementCandidates` in `src/engine/health/deterioration.js` for the field holding the retrieval count since creation; use that name instead of `retrievals_since` if it differs, and keep the sentence shape the test asserts.)

- [ ] **Step 4: Run** — `node --test tests/engine/legacy-lifecycle.test.js tests/engine/forgetting.test.js && npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(lifecycle): readable archive reasons and restore from legacy`

---

### Task 3: Legacy recall

**Files:**
- Modify: `src/engine/retrieve.js`, `src/hooks/session-start.js` (`microPack`), `src/semantic/vectors.js`, `src/semantic/provider.js`
- Test: `tests/engine/legacy-recall.test.js` (new)

**Interfaces:**
- Consumes: `RECALL_STATES` (Task 1).
- Produces: retrieval hits for legacy atoms carry `lifecycle_state: 'legacy'` and content starting `No longer done:`; `microPack` prints `[LEGACY <id>]`; `syncVectors({ store, projectId, embedder, states = EFFECTIVE_STATES })`.

- [ ] **Step 1: Failing tests** — use `DD_RETRIEVAL=lexical`, like `tests/engine/write-retrieve.test.js` (copy its store/atom setup):

```js
// tests/engine/legacy-recall.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { retrieveMemories } from '../../src/engine/retrieve.js';
import { microPack } from '../../src/hooks/session-start.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, topic, extra = {}) => ({ id, project_id: 'demo', memory_type: 'procedure', scope: 'project',
  title: 'Publish the package', trigger: 'when publishing the npm package', behavior_delta: `Publish with method ${id}.`,
  what: 'Publishing.', why: 'Release flow.', authority: 'validated', confidence: 0.9, valid_from: '2026-09-01T00:00:00.000Z',
  topic_key: topic, tags: [], evidence_refs: [], trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [],
  applies_to: { files: [], components: [], operations: [] }, ...PROVENANCE, lifecycle_state: 'active', ...extra });
const legacy = (id, topic, extra = {}) => atom(id, topic, { lifecycle_state: 'legacy', legacy_reason: 'Tokens leaked.',
  legacy_at: '2026-09-20T00:00:00.000Z', ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-legacy-recall-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}
const ask = s => retrieveMemories({ project_id: 'demo', action: 'publishing the npm package', budget_tokens: 2000 }, { store: s });

test('an uncovered legacy memory is recalled as a warning', async t => {
  const s = await store(t);
  await s.putAtom(legacy('old1', 'release/npm/publish'));
  const { memories } = await ask(s);
  const hit = memories.find(m => m.id === 'old1');
  assert.equal(hit.lifecycle_state, 'legacy');
  assert.match(hit.content, /^No longer done: Publish with method old1\. Abandoned because: Tokens leaked\. Now: no replacement recorded\./);
  assert.match(microPack(memories), /\[LEGACY old1\]/);
});

test('a legacy memory is dropped when its replacement or a topic peer is in the pack', async t => {
  const s = await store(t);
  await s.putAtom(atom('new1', 'release/npm/publish'));
  await s.putAtom(legacy('old2', 'release/npm/publish'));
  await s.putAtom(legacy('old3', 'release/npm/publish-token', { replaced_by: 'new1' }));
  const ids = (await ask(s)).memories.map(m => m.id);
  assert.ok(ids.includes('new1'));
  assert.ok(!ids.includes('old2'));
  assert.ok(!ids.includes('old3'));
});

test('a legacy memory whose replacement is no longer effective is recalled', async t => {
  const s = await store(t);
  await s.putAtom(atom('gone', 'release/npm/other', { lifecycle_state: 'archived', archived_reason: 'Unused.' }));
  await s.putAtom(legacy('old4', 'release/npm/publish', { replaced_by: 'gone' }));
  assert.ok((await ask(s)).memories.some(m => m.id === 'old4'));
});
```

- [ ] **Step 2: Run** — `DD_RETRIEVAL=lexical node --test tests/engine/legacy-recall.test.js` → FAIL.

- [ ] **Step 3: Implement** in `src/engine/retrieve.js`:
- import `RECALL_STATES` from `../store/paths.js`; use it for `store.search({ ..., lifecycleStates: RECALL_STATES })` and in the semantic loop (`RECALL_STATES.includes(atom.lifecycle_state)`).
- before the `for (const candidate of scored)` loop build what current guidance the whole scored set holds, then skip covered legacy atoms:

```js
  // Legacy knowledge warns only where nothing current speaks: its replacement
  // or any effective memory on its topic, among the memories this request
  // reached, makes the warning redundant. It is filtered, never boosted.
  const current = scored.filter(c => c.atom.lifecycle_state !== 'legacy').map(c => c.atom);
  const covered = atom => current.some(a => a.id === atom.replaced_by || a.topic_key === atom.topic_key);
```

  and first line inside the loop after `const { atom, applicability, value } = candidate;`:
  `if (atom.lifecycle_state === 'legacy' && covered(atom)) continue;`
- state: `const legacy = atom.lifecycle_state === 'legacy';` and `const state = legacy ? 'legacy' : reviewRequired ? ...` (legacy wins over review_required).
- options for a legacy atom are micro only:

```js
    const options = legacy
      ? [{ form_type: 'micro', content: `No longer done: ${formsList(atom).find(f => f.form_type === 'micro')?.content ?? atom.behavior_delta} `
          + `Abandoned because: ${atom.legacy_reason}. Now: ${atom.replaced_by ?? 'no replacement recorded'}.` }]
      : withheld ? /* existing */ ...
```

`src/hooks/session-start.js` `microPack`: add `: memory.lifecycle_state === 'legacy' ? 'LEGACY'` before the `review_required` branch.

`src/semantic/vectors.js`: `export async function syncVectors({ store, projectId, embedder, states = ['active', 'contested'] })` and use `lifecycleStates: states`. `src/semantic/provider.js` `semanticRetrieve`: `syncVectors({ ..., states: RECALL_STATES })`.

- [ ] **Step 4: Run** — the new test, `npm test`, `npm run eval` → PASS, eval unchanged.
- [ ] **Step 5: Commit** — `feat(retrieve): recall uncovered legacy memories as warnings`

---

### Task 4: Actions — filing and validation

**Files:**
- Create: `src/engine/actions.js`
- Test: `tests/engine/actions-file.test.js`

**Interfaces:**
- Produces:
  - `ACTION_KINDS = ['archive','restore','delete','legacy','merge','split','retopic','resolve']`
  - `fileActions(rawActions, { store, projectId, sessionId, captureSource = 'agent' }) → [{ id, kind, status: 'pending' } | { kind, error }]`
  - `checkProposal(raw, projectId) → string[]` (empty when admissible)
  - `snapshotOf(atom) → string` = `` `${atom.updated_at}|${atom.lifecycle_state}` ``
  - Stored action shape: `{ id, project_id, kind, targets: [id], fields: {...}, rationale, evidence_refs, capture_source, session_id, created_at, snapshot: { [id]: string }, status: 'pending', revises?: id }`

Allowed target states and counts:

```js
const RULES = {
  archive: { states: ['active', 'contested', 'superseded', 'legacy'], min: 1, max: 50, fields: ['archived_reason'] },
  restore: { states: ['archived', 'legacy'], min: 1, max: 50, fields: [] },
  delete: { states: ['archived', 'rejected', 'candidate'], min: 1, max: 50, fields: [] },
  legacy: { states: ['active', 'contested', 'superseded'], min: 1, max: 50, fields: ['legacy_reason'] },
  merge: { states: ['active', 'contested', 'superseded', 'legacy'], min: 2, max: 10, fields: ['result'] },
  split: { states: ['active', 'contested'], min: 1, max: 1, fields: ['results'] },
  retopic: { states: ['active', 'contested'], min: 1, max: 1, fields: ['topic_key'] },
  resolve: { states: ['contested'], min: 2, max: 2, fields: ['winner', 'loser_state'] },
};
```

- [ ] **Step 1: Failing tests**

```js
// tests/engine/actions-file.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createMemoryStore } from '../../src/store/create-store.js';
import { fileActions } from '../../src/engine/actions.js';
import { PROVENANCE } from '../helpers/atom.js';

const atom = (id, state = 'active', extra = {}) => ({ id, project_id: 'demo', memory_type: 'lesson', scope: 'project',
  title: `T ${id}`, trigger: `when ${id}`, behavior_delta: `Do ${id}.`, what: `W ${id}.`, why: `Y ${id}.`, authority: 'validated',
  confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z', topic_key: `demo/area/${id}`, tags: [], evidence_refs: [],
  trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [], applies_to: { files: [], components: [], operations: [] },
  ...PROVENANCE, lifecycle_state: state, ...extra });
async function store(t) {
  const root = await mkdtemp(join(tmpdir(), 'dd-actions-'));
  const s = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data'), repoRoot: root });
  t.after(() => s.close());
  return s;
}

test('a valid action is filed pending with a snapshot of its targets', async t => {
  const s = await store(t);
  await s.putAtom(atom('c1'));
  const [filed] = await fileActions([{ kind: 'archive', targets: ['c1'], archived_reason: 'Duplicate of c2.',
    rationale: 'The user asked to archive it.' }], { store: s, projectId: 'demo', sessionId: 's1' });
  assert.equal(filed.status, 'pending');
  const stored = await s.getAction(filed.id);
  assert.equal(stored.snapshot.c1, `${(await s.getAtom('c1', 'demo')).updated_at}|active`);
  assert.equal(stored.session_id, 's1');
  assert.equal((await s.getAtom('c1', 'demo')).lifecycle_state, 'active');
});

test('unknown targets, wrong states, missing fields and non-English rationale are refused at filing', async t => {
  const s = await store(t);
  await s.putAtom(atom('c2'));
  const results = await fileActions([
    { kind: 'archive', targets: ['nope'], archived_reason: 'x', rationale: 'Asked.' },
    { kind: 'delete', targets: ['c2'], rationale: 'Asked.' },
    { kind: 'legacy', targets: ['c2'], rationale: 'Asked.' },
    { kind: 'archive', targets: ['c2'], archived_reason: 'Ya no sirve para nada en este proyecto.', rationale: 'El usuario lo pidió así.' },
    { kind: 'teleport', targets: ['c2'], rationale: 'Asked.' },
  ], { store: s, projectId: 'demo' });
  assert.deepEqual(results.map(r => r.error), ['target_not_found:nope', 'target_state_not_allowed:c2:active',
    'field_required:legacy_reason', 'action_must_be_english', 'unknown_action_kind']);
  assert.equal((await s.listActions('demo')).length, 0);
});

test('a merge result is checked like a proposal when filed', async t => {
  const s = await store(t);
  await s.putAtom(atom('c3'));
  await s.putAtom(atom('c4'));
  const [bad] = await fileActions([{ kind: 'merge', targets: ['c3', 'c4'], rationale: 'Same rule.',
    result: { topic_key: 'demo/area/c3', trigger: 'when merging', behavior_delta: '', why: 'Same.' } }], { store: s, projectId: 'demo' });
  assert.match(bad.error, /^result_not_admissible:/);
  await s.putAtom(atom('c5', 'legacy', { legacy_reason: 'Old.' }));
  const [mixed] = await fileActions([{ kind: 'merge', targets: ['c3', 'c5'], rationale: 'Same rule.', legacy_reason: 'Old.',
    result: { topic_key: 'demo/area/c3', trigger: 'when merging rules', behavior_delta: 'Merge them.', why: 'Same.',
      capture_origin: 'model_initiated', evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] } }],
    { store: s, projectId: 'demo' });
  assert.equal(mixed.error, 'mixed_legacy_merge');
});
```

- [ ] **Step 2: Run** — `node --test tests/engine/actions-file.test.js` → FAIL (module missing).

- [ ] **Step 3: Implement** `src/engine/actions.js` (filing half):

```js
import { randomUUID } from 'node:crypto';
import { normalizeProposal, validateContract } from './contract.js';
import { decideAdmission } from './v2/admission.js';
import { looksNonEnglish } from './language.js';
import { sanitizeText } from './v2/sanitizer.js';
import { assertTopicKeyPath } from '../store/paths.js';

// An action is a request to change the store, filed by the agent and applied
// only by a person in the audit UI (src/ui/server.js). Filing never changes a
// memory: it validates, records a snapshot of every target and waits.
export const ACTION_KINDS = ['archive', 'restore', 'delete', 'legacy', 'merge', 'split', 'retopic', 'resolve'];
const RULES = { /* as in the Interfaces block above */ };
const text = value => sanitizeText(value ?? '').trim();

export const snapshotOf = atom => `${atom.updated_at}|${atom.lifecycle_state}`;

// The reasons a proposal-shaped result would be refused, or [] when admissible.
export function checkProposal(raw, projectId) {
  const atom = normalizeProposal({ ...raw, project_id: projectId }, projectId, { captureSource: 'agent' });
  const gate = decideAdmission(atom);
  return [...validateContract(atom), ...(gate.decision === 'write' ? [] : gate.reasons)];
}

async function validate(raw, { store, projectId }) {
  const rule = RULES[raw.kind];
  if (!rule) return 'unknown_action_kind';
  const targets = [...new Set((raw.targets ?? []).map(String))];
  if (targets.length < rule.min || targets.length > rule.max) return `target_count:${rule.min}-${rule.max}`;
  for (const field of rule.fields) if (raw[field] === undefined || raw[field] === '' || raw[field] === null) return `field_required:${field}`;
  const rationale = text(raw.rationale);
  if (!rationale) return 'rationale_required';
  const prose = [rationale, raw.archived_reason, raw.legacy_reason].filter(Boolean).join(' ');
  if (looksNonEnglish(prose)) return 'action_must_be_english';
  const atoms = [];
  for (const id of targets) {
    const atom = await store.getAtom(id, projectId);
    if (!atom) return `target_not_found:${id}`;
    if (!rule.states.includes(atom.lifecycle_state)) return `target_state_not_allowed:${id}:${atom.lifecycle_state}`;
    atoms.push(atom);
  }
  if (raw.kind === 'merge') {
    const legacy = atoms.filter(a => a.lifecycle_state === 'legacy').length;
    if (legacy && legacy !== atoms.length) return 'mixed_legacy_merge';
    if (legacy && !text(raw.legacy_reason)) return 'field_required:legacy_reason';
    const reasons = checkProposal(raw.result, projectId);
    if (reasons.length) return `result_not_admissible:${reasons.join(',')}`;
  }
  if (raw.kind === 'split') {
    if (!Array.isArray(raw.results) || raw.results.length < 2 || raw.results.length > 5) return 'split_results:2-5';
    for (const result of raw.results) {
      const reasons = checkProposal(result, projectId);
      if (reasons.length) return `result_not_admissible:${reasons.join(',')}`;
    }
  }
  if (raw.kind === 'retopic') { try { assertTopicKeyPath(raw.topic_key); } catch { return 'invalid_topic_key'; } }
  if (raw.kind === 'resolve') {
    if (!targets.includes(raw.winner)) return 'winner_must_be_target';
    if (!['superseded', 'legacy'].includes(raw.loser_state)) return 'loser_state:superseded|legacy';
    if (raw.loser_state === 'legacy' && !text(raw.legacy_reason)) return 'field_required:legacy_reason';
  }
  if (raw.kind === 'legacy' && raw.replaced_by && !(await store.getAtom(raw.replaced_by, projectId))) return `target_not_found:${raw.replaced_by}`;
  return { targets, atoms, rationale };
}

const FIELDS = ['archived_reason', 'legacy_reason', 'replaced_by', 'result', 'results', 'topic_key', 'winner', 'loser_state'];

export async function fileActions(rawActions, { store, projectId, sessionId, captureSource = 'agent' }) {
  if (!Array.isArray(rawActions) || !rawActions.length) throw new Error('nonempty_actions_required');
  const results = [];
  for (const raw of rawActions) {
    const checked = await validate(raw, { store, projectId });
    if (typeof checked === 'string') { results.push({ kind: raw.kind, error: checked }); continue; }
    const action = { id: randomUUID(), project_id: projectId, kind: raw.kind, targets: checked.targets,
      fields: Object.fromEntries(FIELDS.filter(f => raw[f] !== undefined).map(f => [f, raw[f]])),
      rationale: checked.rationale, evidence_refs: raw.evidence_refs ?? [], capture_source: captureSource,
      session_id: sessionId ?? null, created_at: new Date().toISOString(),
      snapshot: Object.fromEntries(checked.atoms.map(a => [a.id, snapshotOf(a)])), status: 'pending',
      ...(raw.revises ? { revises: String(raw.revises) } : {}) };
    await store.putAction(action);
    results.push({ id: action.id, kind: action.kind, status: 'pending' });
  }
  return results;
}
```

(`looksNonEnglish` is exported by `src/engine/language.js`; confirm with `grep -n "export function looksNonEnglish" src/engine/language.js`.)

- [ ] **Step 4: Run** — `node --test tests/engine/actions-file.test.js` → PASS.
- [ ] **Step 5: Commit** — `feat(actions): file and validate store actions`

---

### Task 5: Actions — apply, reject, stale snapshots

**Files:**
- Modify: `src/engine/actions.js`
- Test: `tests/engine/actions-apply.test.js`

**Interfaces:**
- Consumes: Task 1 `commitAtoms(..., actionWrites)`, `logAction`; Task 4 action shape.
- Produces: `applyAction(id, { store, projectId, actor, rationale }) → { applied: true, kind, changed: [id] }`, throws `action_not_found`, `human_review_required`, `revision_requested`, `action_stale`; on stale also marks the file `status: 'stale'`. `rejectAction(id, { store, projectId, actor, note }) → { rejected: true }`.

- [ ] **Step 1: Failing tests** (setup helpers copied from Task 4's test file):

```js
// tests/engine/actions-apply.test.js — plus the atom()/store() helpers from actions-file.test.js
import { fileActions, applyAction, rejectAction } from '../../src/engine/actions.js';
import { HUMAN_REVIEW } from '../../src/engine/lifecycle.js';

const file = async (s, action) => (await fileActions([{ rationale: 'The user asked for it.', ...action }], { store: s, projectId: 'demo' }))[0].id;
const apply = (s, id) => applyAction(id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Reviewed.' });
const state = async (s, id) => (await s.getAtom(id, 'demo'))?.lifecycle_state;
const result = { topic_key: 'demo/area/merged', title: 'Merged rule', trigger: 'when doing merged work',
  behavior_delta: 'Do the merged thing.', why: 'Both said the same.', capture_origin: 'model_initiated',
  evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked to merge.' }] };

test('applying needs human review and changes nothing before', async t => {
  const s = await store(t);
  await s.putAtom(atom('d1'));
  const id = await file(s, { kind: 'archive', targets: ['d1'], archived_reason: 'Unused.' });
  await assert.rejects(applyAction(id, { store: s, projectId: 'demo' }), /human_review_required/);
  assert.equal(await state(s, 'd1'), 'active');
  await apply(s, id);
  assert.equal(await state(s, 'd1'), 'archived');
  assert.equal((await s.getAtom('d1', 'demo')).archived_reason, 'Unused.');
  assert.equal(await s.getAction(id), null);
  assert.equal((await s.listActionLog('demo'))[0].outcome, 'applied');
});

test('merge moves each source one step down and admits the result', async t => {
  const s = await store(t);
  await s.putAtom(atom('d2'));
  await s.putAtom(atom('d3', 'superseded'));
  await apply(s, await file(s, { kind: 'merge', targets: ['d2', 'd3'], result }));
  const merged = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['active'] })).find(a => a.topic_key === 'demo/area/merged');
  assert.equal(merged.authority, 'validated');
  assert.equal((await s.getAtom('d2', 'demo')).superseded_by, merged.id);
  assert.equal(await state(s, 'd3'), 'archived');
  assert.equal((await s.getAtom('d3', 'demo')).archived_reason, `merged into ${merged.id}`);
});

test('an all-legacy merge yields one legacy memory and archives its sources', async t => {
  const s = await store(t);
  await s.putAtom(atom('d4', 'legacy', { legacy_reason: 'Old.' }));
  await s.putAtom(atom('d5', 'legacy', { legacy_reason: 'Old.' }));
  await apply(s, await file(s, { kind: 'merge', targets: ['d4', 'd5'], result, legacy_reason: 'Both describe the removed installer.' }));
  const merged = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['legacy'] })).find(a => a.topic_key === 'demo/area/merged');
  assert.equal(merged.legacy_reason, 'Both describe the removed installer.');
  assert.equal(await state(s, 'd4'), 'archived');
});

test('a merge whose result topic belongs to another memory is refused and changes nothing', async t => {
  const s = await store(t);
  await s.putAtom(atom('d7'));
  await s.putAtom(atom('d8'));
  await s.putAtom(atom('holder', 'active', { topic_key: 'demo/area/merged' }));
  const id = await file(s, { kind: 'merge', targets: ['d7', 'd8'], result });
  await assert.rejects(apply(s, id), /topic_key_taken/);
  assert.equal(await state(s, 'd7'), 'active');
  assert.ok(await s.getAction(id));
});

test('a target changed since filing makes the action stale', async t => {
  const s = await store(t);
  await s.putAtom(atom('d9'));
  const id = await file(s, { kind: 'legacy', targets: ['d9'], legacy_reason: 'Abandoned.' });
  await s.putAtom({ ...(await s.getAtom('d9', 'demo')), why: 'Edited since.' });
  await assert.rejects(apply(s, id), /action_stale/);
  assert.equal((await s.getAction(id)).status, 'stale');
  assert.equal(await state(s, 'd9'), 'active');
});

test('each kind applies', async t => {
  const s = await store(t);
  await s.putAtom(atom('e1', 'archived', { archived_reason: 'x' }));
  await s.putAtom(atom('e2', 'rejected'));
  await s.putAtom(atom('e3'));
  await s.putAtom(atom('e4'));
  await apply(s, await file(s, { kind: 'restore', targets: ['e1'] }));
  assert.equal(await state(s, 'e1'), 'active');
  await apply(s, await file(s, { kind: 'delete', targets: ['e2'] }));
  assert.equal(await s.getAtom('e2', 'demo'), null);
  await apply(s, await file(s, { kind: 'legacy', targets: ['e3'], legacy_reason: 'Abandoned.', replaced_by: 'e4' }));
  assert.equal((await s.getAtom('e3', 'demo')).replaced_by, 'e4');
  await apply(s, await file(s, { kind: 'retopic', targets: ['e4'], topic_key: 'demo/moved/e4' }));
  const moved = (await s.listAtoms({ projectId: 'demo', lifecycleStates: ['active'] })).find(a => a.topic_key === 'demo/moved/e4');
  assert.ok(moved);
  assert.equal(await state(s, 'e4'), 'superseded');
  await apply(s, await file(s, { kind: 'split', targets: [moved.id], results: [
    { ...result, topic_key: 'demo/split/one', trigger: 'when doing the first part', behavior_delta: 'Do part one.' },
    { ...result, topic_key: 'demo/split/two', trigger: 'when doing the second part', behavior_delta: 'Do part two.' }] }));
  assert.equal(await state(s, moved.id), 'superseded');
});

test('resolve sends the loser to the chosen state', async t => {
  const s = await store(t);
  await s.putAtom(atom('f1', 'contested'));
  await s.putAtom(atom('f2', 'contested'));
  await s.commitAtoms([], [{ source_atom_id: 'f1', relation_type: 'contradicts', target_atom_id: 'f2' }]);
  await apply(s, await file(s, { kind: 'resolve', targets: ['f1', 'f2'], winner: 'f1', loser_state: 'legacy', legacy_reason: 'Proved wrong.' }));
  assert.equal(await state(s, 'f1'), 'active');
  assert.equal(await state(s, 'f2'), 'legacy');
});

test('reject removes the action and logs it', async t => {
  const s = await store(t);
  await s.putAtom(atom('g1'));
  const id = await file(s, { kind: 'archive', targets: ['g1'], archived_reason: 'Unused.' });
  await rejectAction(id, { store: s, projectId: 'demo', actor: HUMAN_REVIEW, note: 'Still useful.' });
  assert.equal(await s.getAction(id), null);
  assert.equal((await s.listActionLog('demo'))[0].note, 'Still useful.');
});
```

(The mixed legacy/non-legacy merge is refused at filing; that case is in Task 4's test.)

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — append to `src/engine/actions.js`:

```js
import { HUMAN_REVIEW, resolveMemories } from './lifecycle.js';
import { stampRevisionFiles, verifyReferences } from './evidence.js';
import { cappedConfidence } from './reliability.js';

function requireReview(actor) { if (actor !== HUMAN_REVIEW) throw new Error('human_review_required'); }
const EFFECTIVE = ['active', 'contested'];

// A proposal-shaped result becomes a reviewed memory in the same commit as the
// change that produced it, as admitMemory would admit it.
async function reviewedAtom(raw, { store, projectId, rationale, lifecycleState, extra = {} }) {
  const atom = normalizeProposal({ ...raw, project_id: projectId }, projectId, { captureSource: 'agent' });
  const reasons = checkProposal(raw, projectId);
  if (reasons.length) throw new Error(`cannot_admit:${reasons.join(',')}`);
  const evidence_state = await verifyReferences(atom.evidence_refs, { store, projectId });
  if (evidence_state.artifacts.some(a => a.status === 'out_of_scope')) throw new Error('evidence_scope_violation');
  const now = new Date().toISOString();
  return stampRevisionFiles({ ...atom, lifecycle_state: lifecycleState, authority: 'validated',
    confidence: cappedConfidence({ ...atom, evidence_state }, { authority: 'validated' }),
    evidence_state: { ...evidence_state, support: 'human_reviewed' },
    review: { source: 'local_ui', reviewed_at: now, rationale }, ...extra }, store);
}

async function topicFree(store, projectId, topic, allowed) {
  const holder = (await store.listByTopicLive(projectId, topic))[0];
  if (holder && !allowed.includes(holder.id)) throw new Error('topic_key_taken');
}

// Each builder returns what one commit writes. Nothing is written until all of
// it is known, so a refusal anywhere leaves the store as it was.
const BUILD = {
  async archive({ atoms, fields, now }) {
    return { atoms: atoms.map(a => ({ ...a, lifecycle_state: 'archived', archived_at: now, archived_reason: fields.archived_reason, contested_at: null })) };
  },
  async restore({ atoms, store, projectId }) {
    for (const a of atoms) await topicFree(store, projectId, a.topic_key, [a.id]);
    return { atoms: atoms.map(a => ({ ...a, lifecycle_state: 'active', archived_at: null, archived_reason: null,
      legacy_reason: null, legacy_at: null, replaced_by: null })) };
  },
  async delete({ atoms }) { return { atoms: [], deleteAtoms: atoms }; },
  async legacy({ atoms, fields, now }) {
    return { atoms: atoms.map(a => ({ ...a, lifecycle_state: 'legacy', legacy_reason: fields.legacy_reason, legacy_at: now,
      replaced_by: fields.replaced_by ?? a.superseded_by ?? null, contested_at: null })) };
  },
  async merge({ atoms, fields, store, projectId, rationale, now }) {
    const allLegacy = atoms.every(a => a.lifecycle_state === 'legacy');
    await topicFree(store, projectId, fields.result.topic_key, atoms.map(a => a.id));
    const result = await reviewedAtom(fields.result, { store, projectId, rationale, lifecycleState: allLegacy ? 'legacy' : 'active',
      extra: allLegacy ? { legacy_reason: fields.legacy_reason, legacy_at: now } : {} });
    const moved = atoms.map(a => EFFECTIVE.includes(a.lifecycle_state)
      ? { ...a, lifecycle_state: 'superseded', superseded_by: result.id, contested_at: null }
      : { ...a, lifecycle_state: 'archived', archived_at: now, archived_reason: `merged into ${result.id}` });
    return { atoms: [...moved, result], relations: atoms.filter(a => EFFECTIVE.includes(a.lifecycle_state))
      .map(a => ({ source_atom_id: result.id, relation_type: 'supersedes', target_atom_id: a.id })) };
  },
  async split({ atoms: [source], fields, store, projectId, rationale }) {
    const results = [];
    for (const raw of fields.results) {
      await topicFree(store, projectId, raw.topic_key, [source.id]);
      results.push(await reviewedAtom(raw, { store, projectId, rationale, lifecycleState: 'active' }));
    }
    return { atoms: [{ ...source, lifecycle_state: 'superseded', superseded_by: results[0].id, contested_at: null }, ...results],
      relations: results.map(r => ({ source_atom_id: r.id, relation_type: 'supersedes', target_atom_id: source.id })) };
  },
  async retopic({ atoms: [source], fields, store, projectId, rationale }) {
    await topicFree(store, projectId, fields.topic_key, []);
    const moved = await reviewedAtom({ ...source, topic_key: fields.topic_key }, { store, projectId, rationale,
      lifecycleState: source.lifecycle_state === 'contested' ? 'contested' : 'active' });
    return { atoms: [{ ...source, lifecycle_state: 'superseded', superseded_by: moved.id, contested_at: null }, moved],
      relations: [{ source_atom_id: moved.id, relation_type: 'supersedes', target_atom_id: source.id }] };
  },
};

export async function applyAction(id, { store, projectId, actor, rationale = 'Applied in the audit UI.' } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const action = await store.getAction(id);
    if (!action || action.project_id !== projectId) throw new Error('action_not_found');
    if (action.revision_requested) throw new Error('revision_requested');
    const atoms = await Promise.all(action.targets.map(t => store.getAtom(t, projectId)));
    const winnerGone = action.kind === 'legacy' && action.fields.replaced_by
      && !EFFECTIVE.includes((await store.getAtom(action.fields.replaced_by, projectId))?.lifecycle_state);
    if (atoms.some((a, i) => !a || snapshotOf(a) !== action.snapshot[action.targets[i]]) || winnerGone) {
      await store.putAction({ ...action, status: 'stale' });
      await store.logAction({ project_id: projectId, action_id: id, kind: action.kind, targets: action.targets, outcome: 'stale', actor_ref: 'local_ui' });
      throw new Error('action_stale');
    }
    if (action.kind === 'resolve') {
      const loser = action.targets.find(t => t !== action.fields.winner);
      await resolveMemories(action.fields.winner, loser, { store, projectId, actor, rationale });
      if (action.fields.loser_state === 'legacy') {
        const resolved = await store.getAtom(loser, projectId);
        await store.putAtom({ ...resolved, lifecycle_state: 'legacy', legacy_reason: action.fields.legacy_reason,
          legacy_at: new Date().toISOString(), replaced_by: action.fields.winner });
      }
      await store.commitAtoms([], [], [], [{ id, value: null }]);
    } else {
      const built = await BUILD[action.kind]({ atoms, fields: action.fields, store, projectId, rationale, now: new Date().toISOString() });
      await store.commitAtoms(built.atoms, built.relations ?? [], built.deleteAtoms ?? [], [{ id, value: null }]);
    }
    await store.logAction({ project_id: projectId, action_id: id, kind: action.kind, targets: action.targets, outcome: 'applied', actor_ref: 'local_ui' });
    return { applied: true, kind: action.kind, changed: action.targets };
  });
}

export async function rejectAction(id, { store, projectId, actor, note } = {}) {
  requireReview(actor);
  return store.withWriteLock(async () => {
    const action = await store.getAction(id);
    if (!action || action.project_id !== projectId) throw new Error('action_not_found');
    await store.commitAtoms([], [], [], [{ id, value: null }]);
    await store.logAction({ project_id: projectId, action_id: id, kind: action.kind, targets: action.targets, outcome: 'rejected',
      note: note?.trim() || null, actor_ref: 'local_ui' });
    return { rejected: true };
  });
}
```

`store.withWriteLock` is re-entrant for these nested calls only if `resolveMemories`/`commitAtoms` already nest today (`admitMemory` calls `store.commitAtoms` inside `store.withWriteLock`, so they do). If the nested `resolveMemories` lock deadlocks in the test, call its body through an exported non-locking helper instead: split `resolveMemories` into `resolvePlan(winner, loser, ...)` returning `atoms` and the existing locked wrapper, and use `resolvePlan` here inside one `commitAtoms`.

- [ ] **Step 4: Run** — `node --test tests/engine/actions-apply.test.js && npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(actions): apply and reject actions in one transaction`

---

### Task 6: Revision requests and `revises`

**Files:**
- Create: `src/engine/revisions.js`
- Modify: `src/engine/write.js`, `src/engine/actions.js`, `src/hooks/run.js`, `src/hooks/session-start.js`, `src/ui/server.js` (prompt hook route)
- Test: `tests/engine/revisions.test.js`, `tests/hooks/stop.test.js` style hook test in `tests/hooks/revisions-hook.test.js`

**Interfaces:**
- Produces:
  - `requestRevision({ kind: 'memory'|'action', id, reason }, { store, projectId, actor }) → item`, throws `revision_reason_required`, `candidate_required`, `action_not_found`
  - `openRevisionRequests(store, projectId) → [{ kind, id, label, reason, at }]`
  - `revisionNotices({ store, projectId, sessionId }) → string|null` (claims delivery per `revision:<id>` / `at`)
  - `proposeMemory` honours `revises`: closes the revised candidate as `rejected` with `revised_by`
  - `fileActions` honours `revises`: removes the revised action file and logs `revised`

- [ ] **Step 1: Failing tests**

```js
// tests/engine/revisions.test.js — store()/atom() helpers as in actions-file.test.js
import { requestRevision, openRevisionRequests, revisionNotices } from '../../src/engine/revisions.js';
import { fileActions } from '../../src/engine/actions.js';
import { proposeMemory } from '../../src/engine/write.js';
import { sweepAutoAccept } from '../../src/engine/auto-accept.js';
import { HUMAN_REVIEW } from '../../src/engine/lifecycle.js';

const proposal = { topic_key: 'demo/rev/one', trigger: 'when revising proposals', behavior_delta: 'Revise with the reason.',
  why: 'Review found a gap.', capture_origin: 'model_initiated', evidence_refs: [{ source_type: 'user_statement', source_ref: 'chat', summary: 'Asked.' }] };

test('a revision request reaches each session once and blocks auto-accept', async t => {
  const s = await store(t);
  const { atom } = await proposeMemory({ ...proposal, project_id: 'demo' }, { store: s });
  await assert.rejects(requestRevision({ kind: 'memory', id: atom.id, reason: ' ' }, { store: s, projectId: 'demo', actor: HUMAN_REVIEW }), /revision_reason_required/);
  await requestRevision({ kind: 'memory', id: atom.id, reason: 'Scope it to the hooks only.' }, { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
  assert.equal((await openRevisionRequests(s, 'demo'))[0].reason, 'Scope it to the hooks only.');
  const first = await revisionNotices({ store: s, projectId: 'demo', sessionId: 's1' });
  assert.match(first, new RegExp(`DD - Revision requested for memory ${atom.id} \\(demo/rev/one\\): Scope it to the hooks only\\. File a corrected version with revises=${atom.id}\\.`));
  assert.equal(await revisionNotices({ store: s, projectId: 'demo', sessionId: 's1' }), null);
  assert.ok(await revisionNotices({ store: s, projectId: 'demo', sessionId: 's2' }));
  await s.saveConfig({ ...(await s.loadConfig()), auto_accept: { enabled: true, confidence_threshold: 0 } });
  assert.deepEqual((await sweepAutoAccept({ store: s, projectId: 'demo' })).admitted, []);
});

test('revises closes the original candidate and the original action', async t => {
  const s = await store(t);
  const { atom } = await proposeMemory({ ...proposal, project_id: 'demo' }, { store: s });
  await requestRevision({ kind: 'memory', id: atom.id, reason: 'Say why.' }, { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
  const revised = await proposeMemory({ ...proposal, project_id: 'demo', why: 'Review found a gap in the hooks.', revises: atom.id }, { store: s });
  const old = await s.getAtom(atom.id, 'demo');
  assert.equal(old.lifecycle_state, 'rejected');
  assert.equal(old.revised_by, revised.atom.id);
  await s.putAtom(atom('h1'));
  const [first] = await fileActions([{ kind: 'archive', targets: ['h1'], archived_reason: 'Unused.', rationale: 'Asked.' }], { store: s, projectId: 'demo' });
  await requestRevision({ kind: 'action', id: first.id, reason: 'Say which duplicate.' }, { store: s, projectId: 'demo', actor: HUMAN_REVIEW });
  await fileActions([{ kind: 'archive', targets: ['h1'], archived_reason: 'Duplicate of h2.', rationale: 'Asked.', revises: first.id }], { store: s, projectId: 'demo' });
  assert.equal(await s.getAction(first.id), null);
  assert.equal((await s.listActionLog('demo'))[0].outcome, 'revised');
  assert.equal((await openRevisionRequests(s, 'demo')).length, 0);
});
```

Hook test (`tests/hooks/revisions-hook.test.js`): copy the `hook()` helper and lexical setup from `tests/hooks/stop.test.js`; propose through `src/engine/write.js` against the same `.dd` and data dir the hook uses (`join(root, '.dd')`, `join(root, '.dd/local')`), request a revision, then assert that `hook(root, 'prompt', { prompt: 'next' })` returns `hookSpecificOutput.additionalContext` matching `/Revision requested for memory/`, a second prompt in the same session does not, and `hook(root, 'session-start', { source: 'startup', session_id: 'other' })` does.

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** `src/engine/revisions.js`:

```js
import { HUMAN_REVIEW } from './lifecycle.js';

// A reviewer's "not yet, change this" on a pending item. The item stays pending
// and cannot be admitted or applied; the reason reaches the agent through the
// prompt and session-start hooks (never PreToolUse, L1), once per session.
export async function requestRevision({ kind, id, reason }, { store, projectId, actor }) {
  if (actor !== HUMAN_REVIEW) throw new Error('human_review_required');
  const text = String(reason ?? '').trim();
  if (!text) throw new Error('revision_reason_required');
  const revision_requested = { reason: text.slice(0, 2000), at: new Date().toISOString() };
  if (kind === 'action') {
    const action = await store.getAction(id);
    if (!action || action.project_id !== projectId) throw new Error('action_not_found');
    return store.putAction({ ...action, revision_requested });
  }
  const atom = await store.getAtom(id, projectId);
  if (!atom || atom.lifecycle_state !== 'candidate') throw new Error('candidate_required');
  return store.putAtom({ ...atom, revision_requested });
}

export async function openRevisionRequests(store, projectId) {
  const memories = (await store.listAtoms({ projectId, lifecycleStates: ['candidate'] })).filter(a => a.revision_requested)
    .map(a => ({ kind: 'memory', id: a.id, label: a.topic_key, ...a.revision_requested }));
  const actions = (await store.listActions(projectId)).filter(a => a.revision_requested)
    .map(a => ({ kind: 'action', id: a.id, label: a.kind, ...a.revision_requested }));
  return [...memories, ...actions];
}

export async function revisionNotices({ store, projectId, sessionId }) {
  if (!sessionId || !store.claimDelivery) return null;
  const lines = [];
  for (const r of await openRevisionRequests(store, projectId)) {
    if (!await store.claimDelivery(projectId, sessionId, `revision:${r.id}`, r.at)) continue;
    lines.push(`DD - Revision requested for ${r.kind} ${r.id} (${r.label}): ${r.reason} File a corrected version with revises=${r.id}.`);
  }
  return lines.length ? lines.join('\n') : null;
}
```

The notice text must end the reason with a period before "File": when `r.reason` lacks final punctuation, append one — `const reason = /[.!?]$/.test(r.reason) ? r.reason : `${r.reason}.`;` and use `${reason}`.

`src/engine/write.js` `proposeMemory`: after `const atom = await store.putAtom(payload);`:

```js
    // A corrected version answers a reviewer's revision request: the revised
    // candidate closes, linked to this one, so only the correction stays pending.
    if (rawPayload.revises) {
      const revised = await store.getAtom(String(rawPayload.revises), payload.project_id);
      if (revised?.lifecycle_state === 'candidate') await store.putAtom({ ...revised, lifecycle_state: 'rejected', revised_by: atom.id });
    }
```

Also add `'revises'` to nothing in `normalizeProposal` (it stays out of the stored atom; `rawPayload` carries it).

`src/engine/actions.js` `fileActions`: after `await store.putAction(action);`:

```js
    if (action.revises) {
      const revised = await store.getAction(action.revises);
      if (revised?.project_id === projectId) {
        await store.commitAtoms([], [], [], [{ id: revised.id, value: null }]);
        await store.logAction({ project_id: projectId, action_id: revised.id, kind: revised.kind, targets: revised.targets,
          outcome: 'revised', note: `revised by ${action.id}`, actor_ref: 'agent' });
      }
    }
```

Hooks:
- `src/hooks/session-start.js` `buildSessionStartContext`: `const revisions = await revisionNotices({ store, projectId, sessionId }).catch(() => null);` and add `revisions` to the `additionalContext` array after `PULL_GUIDANCE` (active branch only).
- `src/ui/server.js` prompt route: `const revisions = sessionId ? await revisionNotices({ store, projectId, sessionId }).catch(() => null) : null;` and send `contextPayload('UserPromptSubmit', [revisions, microPack(result.memories ?? [])].filter(Boolean).join('\n'))`.
- `src/hooks/run.js` lexical prompt path: same join before `ok(contextPayload('UserPromptSubmit', ...))`.

- [ ] **Step 4: Run** — both new tests, `npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(review): revision requests with reasons delivered to the agent`

---

### Task 7: MCP — `act`, `similar`, `revises`, status

**Files:**
- Modify: `src/mcp/definition.js`, `src/mcp/tools.js`, `src/hooks/bridge.js`, `src/ui/server.js` (hook routes), `src/semantic/provider.js`
- Test: `tests/mcp/protocol.test.js`, `tests/mcp/actions.test.js` (new)

**Interfaces:**
- Consumes: `fileActions`, `openRevisionRequests`, `syncVectors`, `cosine`.
- Produces: MCP tools `act({ actions, session_id? })`, `similar({ id?, text?, limit? })`; `propose` proposals accept `revises`; `status` returns `pending_actions`, `revision_requests`, `archive_review` (`{ archived, threshold, due }`); `callRunningStore('similar', ...)`; `semanticRetrieve.similar({ store, projectId, id, text, limit }) → [{ id, topic_key, title, lifecycle_state, similarity }]`.

- [ ] **Step 1: Failing tests**

```js
// tests/mcp/actions.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createMcpServer } from '../../src/mcp/definition.js';
import { PROVENANCE } from '../helpers/atom.js';

test('act files pending actions; no tool applies them; status counts them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-mcp-act-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  await store.putAtom({ id: 'm1', project_id: 'demo', memory_type: 'lesson', scope: 'project', title: 'T', trigger: 'when t',
    behavior_delta: 'Do t.', what: 'W.', why: 'Y.', authority: 'validated', confidence: 0.8, valid_from: '2026-09-01T00:00:00.000Z',
    topic_key: 'demo/area/m1', tags: [], evidence_refs: [], trigger_variants: [], assumptions: [], revisit_when: [], alternatives: [],
    applies_to: { files: [], components: [], operations: [] }, ...PROVENANCE, lifecycle_state: 'active' });
  const server = createMcpServer({ store, projectId: 'demo' });
  const client = new Client({ name: 'act-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); store.close(); });
  const { tools } = await client.listTools();
  assert.ok(tools.some(x => x.name === 'act') && tools.some(x => x.name === 'similar'));
  assert.equal(tools.some(x => /apply|approve/.test(x.name)), false);
  const filed = JSON.parse((await client.callTool({ name: 'act', arguments: { actions: [
    { kind: 'archive', targets: ['m1'], archived_reason: 'Unused.', rationale: 'The user asked.' }] } })).content[0].text);
  assert.equal(filed.actions[0].status, 'pending');
  const status = JSON.parse((await client.callTool({ name: 'status', arguments: {} })).content[0].text);
  assert.equal(status.pending_actions, 1);
  assert.deepEqual(status.revision_requests, []);
  assert.equal(status.archive_review.due, false);
});
```

In `tests/mcp/protocol.test.js`, the existing self-approval assertion list stays; add `'apply'` to it.

- [ ] **Step 2: Run** — `npm run test:mcp` → FAIL.

- [ ] **Step 3: Implement**

`src/mcp/definition.js`:

```js
const action = z.object({
  kind: z.enum(['archive', 'restore', 'delete', 'legacy', 'merge', 'split', 'retopic', 'resolve']),
  targets: z.array(z.string().max(150)).min(1).max(50), rationale: text,
  evidence_refs: z.array(evidence).max(12).optional(), archived_reason: text.optional(), legacy_reason: text.optional(),
  replaced_by: z.string().max(150).optional(), result: proposal.optional(), results: z.array(proposal).min(2).max(5).optional(),
  topic_key: z.string().max(150).optional(), winner: z.string().max(150).optional(),
  loser_state: z.enum(['superseded', 'legacy']).optional(), revises: z.string().max(150).optional(),
});
```

add `revises: z.string().max(150).optional().describe('Id of a candidate this corrects after a revision request.')` to `proposal`, and to `definitions`:

```js
    act: ['Request store changes for human review in the audit UI: archive, restore, delete, legacy, merge, split, retopic, resolve. '
      + 'Nothing changes until a person applies it; never claim it was applied. Give a rationale in English; use revises=<id> to answer a revision request.',
      { actions: z.array(action).min(1).max(20), session_id: z.string().max(150).optional() }],
    similar: ['Find the memories nearest to a memory id or a text, in any state except rejected, to spot overlaps before proposing or merging.',
      { id: z.string().max(150).optional(), text: z.string().max(2000).optional(), limit: z.number().int().min(1).max(20).optional() }],
```

`src/mcp/tools.js`:

```js
    async act({ actions, session_id }) {
      return { actions: await fileActions(actions, { store, projectId, sessionId: session_id }) };
    },
    async similar(request) {
      if (!request.id && !request.text) throw new Error('id_or_text_required');
      const bridged = await callRunningStore('similar', request, repoRoot ?? store.repoRoot);
      if (bridged && !bridged.error) return bridged;
      return { error: { code: 503, message: bridged?.error?.message ?? residentNotice({ state: 'unreachable' }) } };
    },
```

and `status` returns additionally:

```js
      const config = await store.loadConfig();
      const archived = counts.archived ?? 0;
      return { project_id: projectId, counts, total, ui_url: await uiUrl(),
        pending_actions: (await store.listActions(projectId)).length,
        revision_requests: await openRevisionRequests(store, projectId),
        archive_review: { archived, threshold: config.archive_review_at, due: archived > config.archive_review_at } };
```

(`counts` from `countByLifecycle` is keyed by state; check its shape with `grep -n "countByLifecycle" -A10 src/store/sqlite-index.js` and adapt the `archived` read.)

`src/hooks/bridge.js`: allow `'similar'` in the command list.

`src/semantic/provider.js`: inside `createSemanticRetrieve`, before `return semanticRetrieve;`:

```js
  semanticRetrieve.similar = async ({ store, projectId, id, text, limit = 8 }) => {
    const active = await ready();
    if (!active) return { error: { code: 503, message: 'embedding model not ready' } };
    const states = ['candidate', 'active', 'contested', 'superseded', 'legacy', 'archived'];
    const vectors = await syncVectors({ store, projectId, embedder: active, states });
    const probe = id ? vectors.get(id) : (await active.embed([queryText(text)], 'query'))[0];
    if (!probe) return { error: { code: 404, message: `not_found:${id}` } };
    const ranked = [...vectors].filter(([other]) => other !== id).map(([other, v]) => [other, cosine(probe, v)])
      .sort((a, b) => b[1] - a[1]).slice(0, Math.min(20, limit));
    return { similar: await Promise.all(ranked.map(async ([other, similarity]) => {
      const atom = await store.getAtom(other, projectId);
      return { id: other, topic_key: atom.topic_key, title: atom.title, lifecycle_state: atom.lifecycle_state,
        similarity: Math.round(similarity * 1000) / 1000 };
    })) };
  };
```

`src/ui/server.js` hook routes, next to `/retrieve`:

```js
        if (url.pathname.endsWith('/similar')) {
          if (!active || !retrieve.similar) return send(res, 200, { error: { code: 503, message: inactiveMessage(retrieval) } });
          return send(res, 200, await retrieve.similar({ store, projectId, id: payload.id, text: payload.text, limit: payload.limit }));
        }
```

- [ ] **Step 4: Run** — `npm run test:mcp && npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(mcp): act, similar, revises and review status`

---

### Task 8: Audit UI — actions, revise, legacy, reasons

**Files:**
- Modify: `src/ui/server.js`, `src/ui/public/index.html`
- Test: `tests/ui/actions.test.js` (new)

**Interfaces:**
- Consumes: `applyAction`, `rejectAction`, `requestRevision`, `listActions`.
- Produces routes (all behind the UI key cookie, the review token and same-origin checks the server already applies to non-GET):
  - `GET /api/actions` → `[{ ...action, target_atoms: [{ id, title, topic_key, lifecycle_state }] }]`
  - `POST /api/actions/:id/apply` body `{ rationale? }`; `POST /api/actions/:id/reject` body `{ note? }`; `POST /api/actions/:id/revise` body `{ reason }`
  - `POST /api/atoms/:id/revise` body `{ reason }`

- [ ] **Step 1: Failing test** — follow `tests/ui/server.test.js` (`startUiServer`, `uiCookie`, `reviewHeaders`):

```js
test('actions are listed, revised, rejected and applied through the UI only with the review token', async t => {
  // store with atom 'u1' active; fileActions archive u1 and legacy u1 (two actions)
  // 1. GET /api/actions → 2 items, target_atoms[0].id === 'u1'
  // 2. POST /api/actions/<a1>/apply without x-dd-review-token → 403 local_review_required
  // 3. POST /api/actions/<a1>/revise { reason: '' } → 409 revision_reason_required; with reason → 200
  // 4. POST /api/actions/<a1>/apply → 409 revision_requested
  // 5. POST /api/actions/<a2>/apply { rationale: 'ok' } → 200; store.getAtom('u1').lifecycle_state === 'legacy'
  // 6. POST /api/actions/<a1>/reject → 200; GET /api/actions → []
});
```

Write each numbered line as real `fetch` calls with `assert.equal(status, …)` using the helpers in `tests/ui/server.test.js` (`json()`, `reviewHeaders(base)`, the cookie from `uiCookie(ui)`).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Implement** — `src/ui/server.js`, before the `/api/atoms/:id` match:

```js
      if (req.method === 'GET' && url.pathname === '/api/actions') {
        return send(res, 200, await Promise.all((await store.listActions(projectId)).map(async action => ({ ...action,
          target_atoms: (await Promise.all(action.targets.map(id => store.getAtom(id, projectId))))
            .map((a, i) => a ? { id: a.id, title: a.title, topic_key: a.topic_key, lifecycle_state: a.lifecycle_state } : { id: action.targets[i], missing: true }) }))));
      }
      const actionMatch = url.pathname.match(/^\/api\/actions\/([^/]+)\/(apply|reject|revise)$/);
      if (req.method === 'POST' && actionMatch) {
        const id = decodeURIComponent(actionMatch[1]);
        const body = await readBody(req);
        if (actionMatch[2] === 'apply') return send(res, 200, await applyAction(id, { store, projectId, actor: HUMAN_REVIEW, rationale: body.rationale }));
        if (actionMatch[2] === 'reject') return send(res, 200, await rejectAction(id, { store, projectId, actor: HUMAN_REVIEW, note: body.note }));
        return send(res, 200, await requestRevision({ kind: 'action', id, reason: body.reason }, { store, projectId, actor: HUMAN_REVIEW }));
      }
```

and extend the atoms regex to `(admit|reject|restore|revise)` with
`if (req.method === 'POST' && action === 'revise') return send(res, 200, await requestRevision({ kind: 'memory', id, reason: body.reason }, { store, projectId, actor: HUMAN_REVIEW }));`

`src/ui/public/index.html`:
- `STATE_CHIPS`: add `{ value: 'legacy', label: 'Legacy' }` after Superseded; add `<option value="legacy">legacy</option>` to `#filter`.
- Detail buttons: for `candidate` add `<button data-act="revise">Request revision</button>`; for `legacy` add the Restore button (same `restore` act).
- Detail body, after the capture line:

```js
        ${selected.revision_requested ? `<p class="notice warning">Revision requested: ${escapeHtml(selected.revision_requested.reason)}. The agent receives this on its next prompt.</p>` : ''}
        ${selected.lifecycle_state === 'archived' ? `<p class="notice">Archived: ${escapeHtml(selected.archived_reason && !/^[a-z_]+$/.test(selected.archived_reason) ? selected.archived_reason : 'reason not recorded')}.</p>` : ''}
        ${selected.lifecycle_state === 'legacy' ? `<p class="notice warning">Legacy: no longer done. ${escapeHtml(selected.legacy_reason ?? '')}${selected.replaced_by ? ` Now: ${escapeHtml(selected.replaced_by)}.` : ''} Agents receive it as a warning when nothing current covers it.</p>` : ''}
```

- `revise` handler in the detail click listener:

```js
        } else if (act === 'revise') {
          const reason = detailEl.querySelector('[name="review_rationale"]').value.trim();
          if (!reason) { msg.textContent = 'Write the reason for the revision in the review note first.'; return; }
          await api('/api/atoms/' + encodeURIComponent(selected.id) + '/revise', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
```

- Actions panel: after `<details id="evidence">…</details>` add

```html
  <details id="actions" open>
    <summary>Pending actions <span id="actions-count"></span></summary>
    <div id="actions-list"></div>
  </details>
```

  and a `loadActions()` called from `load()` after `loadEvidence()`:

```js
    const STEP = { archive: () => 'archived', restore: () => 'active', delete: () => 'deleted', legacy: () => 'legacy',
      merge: s => ['active', 'contested'].includes(s) ? 'superseded' : 'archived', split: () => 'superseded',
      retopic: () => 'superseded', resolve: () => 'resolved' };
    async function loadActions() {
      const actions = await api('/api/actions');
      document.getElementById('actions-count').textContent = actions.length ? `· ${actions.length}` : '· none';
      document.getElementById('actions-list').innerHTML = actions.map(a => `
        <div class="observation action" data-action="${escapeHtml(a.id)}">
          <span class="badge">${escapeHtml(a.kind)}</span>${a.status === 'stale' ? ' <span class="badge">stale: review again</span>' : ''}
          <p>${escapeHtml(a.rationale)}</p>
          ${a.revision_requested ? `<p class="notice warning">Revision requested: ${escapeHtml(a.revision_requested.reason)}</p>` : ''}
          <ul>${a.target_atoms.map(t => `<li>${escapeHtml(t.topic_key ?? t.id)} · ${escapeHtml(t.lifecycle_state ?? 'missing')} → ${escapeHtml(STEP[a.kind](t.lifecycle_state))}</li>`).join('')}</ul>
          ${a.fields.result ? `<p>Result: <b>${escapeHtml(a.fields.result.topic_key)}</b> — ${escapeHtml(a.fields.result.behavior_delta)}</p>` : ''}
          ${(a.fields.results ?? []).map(r => `<p>Result: <b>${escapeHtml(r.topic_key)}</b> — ${escapeHtml(r.behavior_delta)}</p>`).join('')}
          ${a.fields.archived_reason ? `<p>Reason: ${escapeHtml(a.fields.archived_reason)}</p>` : ''}
          ${a.fields.legacy_reason ? `<p>Abandoned because: ${escapeHtml(a.fields.legacy_reason)}</p>` : ''}
          <textarea name="action_note" placeholder="Note or revision reason"></textarea>
          <div class="row"><button class="ok" data-action-act="apply">Apply</button><button data-action-act="revise">Request revision</button><button class="danger" data-action-act="reject">Reject</button></div>
        </div>`).join('') || '<p>No pending actions. The agent files them with the dd act tool.</p>';
    }
    document.getElementById('actions-list').addEventListener('click', async (ev) => {
      const act = ev.target.dataset.actionAct;
      const card = ev.target.closest('[data-action]');
      if (!act || !card) return;
      const note = card.querySelector('[name="action_note"]').value.trim();
      try {
        if (act === 'revise' && !note) throw new Error('revision_reason_required');
        if (act === 'delete' && !confirm('Apply this action?')) return;
        await api(`/api/actions/${encodeURIComponent(card.dataset.action)}/${act}`, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify(act === 'apply' ? { rationale: note || DEFAULT_REVIEW_RATIONALE } : act === 'reject' ? { note } : { reason: note }) });
        await load();
      } catch (err) { card.querySelector('p').textContent = friendlyError(err.message); }
    });
```

  Confirmation: for a `delete` kind, confirm before apply — replace the `act === 'delete'` line with `if (act === 'apply' && card.querySelector('.badge').textContent === 'delete' && !confirm('Delete these memories permanently?')) return;`.
- `ERROR_HINTS`: add `action_stale: 'A memory in this action changed since it was filed. Reject it and ask the agent for a new one.'`, `revision_requested: 'A revision was requested; wait for the corrected version or reject this one.'`, `revision_reason_required: 'Write the reason for the revision first.'`, `topic_key_taken: 'Another memory already holds that topic.'`, `archive_reason_required: 'An archive needs a reason.'`.

- [ ] **Step 4: Run** — `npm run test:ui`, then restart the resident and check the page in Chrome: file an action from this session with `act`, see it in the panel, request a revision, apply another; console shows no errors (CSP nonce still covers the single script).
- [ ] **Step 5: Commit** — `feat(ui): review actions, request revisions, show legacy and archive reasons`

---

### Task 9: Archive review prompt

**Files:**
- Modify: `src/hooks/session-start.js`, `src/ui/public/index.html`
- Test: `tests/hooks/session-start.test.js`

**Interfaces:**
- Consumes: `config.archive_review_at` (Task 1).
- Produces: session-start line `DD - The archive holds <n> memories (review at <t>). Offer the user /dd:clean to restore what is still useful and delete the rest.`

- [ ] **Step 1: Failing test** — in `tests/hooks/session-start.test.js`: create a store, save config `archive_review_at: 1`, put two `archived` atoms with `archived_reason`, call `buildSessionStartContext`, assert the context matches `/The archive holds 2 memories \(review at 1\)/`; with `archive_review_at: 5` it does not.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** in `buildSessionStartContext` (active branch, once per session through the `alreadyPrimed` check):

```js
  const config = await store.loadConfig();
  const archivedCount = await store.countAtoms({ projectId, lifecycleStates: ['archived'] });
  const archiveNote = !alreadyPrimed && archivedCount > config.archive_review_at
    ? `DD - The archive holds ${archivedCount} memories (review at ${config.archive_review_at}). Offer the user /dd:clean to restore what is still useful and delete the rest.` : null;
```

  add `archiveNote` to the context array after `revisions`. In `index.html` `load()`, when `status.archive_review?.due` (read `/api/status`, extend that route with the same `archive_review` object as MCP status), show a `notice` line in `#unsupported`'s sibling: "Archive holds N memories; ask the agent for /dd:clean."
- [ ] **Step 4: Run** — `npm run test:hooks && npm test` → PASS.
- [ ] **Step 5: Commit** — `feat(hooks): prompt an archive cleanup past the review threshold`

---

### Task 10: Commands and the `dd` plugin name

**Files:**
- Rename: `skills/dd` → `skills/recall`, `skills/dd-audit` → `skills/audit`, `skills/dd-save` → `skills/save` (update each `name:` line)
- Create: `skills/review/SKILL.md`, `skills/compact/SKILL.md`, `skills/clean/SKILL.md`, `skills/prospect/SKILL.md`, `skills/init/SKILL.md`
- Modify: `.claude-plugin/plugin.json` (`"name": "dd"`), `.claude-plugin/marketplace.json` (plugin entry name `dd`), `scripts/install-codex.mjs` (skill list), `README.md` install table (`/plugin install dd@deltadictum`)
- Test: `tests/hooks/install.test.js` (skill list), `tests/skills/skills.test.js` (new)

- [ ] **Step 1: Failing test**

```js
// tests/skills/skills.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SKILLS = ['recall', 'audit', 'save', 'review', 'compact', 'clean', 'prospect', 'init'];
test('every command skill exists, is named after its directory and files only through propose or act', async () => {
  for (const name of SKILLS) {
    const text = await readFile(new URL(`../../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
    assert.match(text, new RegExp(`^---\\nname: ${name}\\n`), name);
    assert.doesNotMatch(text, /[áéíóúñ¿¡]/, `${name} must be English`);
  }
  const init = await readFile(new URL('../../skills/init/SKILL.md', import.meta.url), 'utf8');
  assert.match(init, /Before exploring anything/);
  assert.match(init, /\/dd:prospect/);
  const plugin = JSON.parse(await readFile(new URL('../../.claude-plugin/plugin.json', import.meta.url), 'utf8'));
  assert.equal(plugin.name, 'dd');
});
```

Add `"tests/skills/**/*.test.js"` to the `test` script in `package.json`. Update `tests/hooks/install.test.js` expectations from `dd`, `dd-audit`, `dd-save` to the new names (grep the file for them).

- [ ] **Step 2: Run** → FAIL.

- [ ] **Step 3: Write the skills.** Each file: frontmatter `name` and `description` (the description says when to use it and that it takes arguments, e.g. `Use for /dd:review [memory-or-action-id] ...`), then the body. Full text:

`skills/review/SKILL.md`

```markdown
---
name: review
description: Work DD revision requests and memories that need review. Use for /dd:review with an optional memory or action id.
---

# Review DD knowledge

Arguments: an optional memory or action id.

With an id:
1. Call `status`; if the id is among `revision_requests`, read the reviewer's reason. Call `get` on the id (for an action, find it in the audit UI list the reason names).
2. Read the current code and the evidence the memory cites.
3. File the corrected version: `propose` with the same `topic_key` and `revises: <id>` for a memory, or `act` with `revises: <id>` for an action. Address the reason exactly; change nothing else.
4. Without a revision request, judge whether the memory still holds against the code. File a revision (`propose`, same `topic_key`), an `act` of kind `legacy` when the practice was abandoned (give `legacy_reason` and `replaced_by` when something replaced it), an `act` of kind `archive` when it is simply no longer useful (give `archived_reason`), or report that it holds.

Without an id: do the above for every entry in `status.revision_requests`, then for every memory `list` shows as `review_required` or that `retrieve` flags with EVIDENCE CHANGED.

Nothing changes until the user applies it in the audit UI. End by saying how many items you filed and giving the address from `ui`. Never say anything was applied.
```

`skills/compact/SKILL.md`

```markdown
---
name: compact
description: Find DD memories that overlap or repeat each other and file merge or retopic actions. Use for /dd:compact.
---

# Compact DD knowledge

1. Page through `list` (active, contested, superseded and legacy).
2. For each memory, call `similar` with its id. Treat as a cluster the memories that say the same thing or whose scopes nest; the same topic area alone is not enough.
3. For each cluster worth merging, file one `act` of kind `merge` with the cluster ids as `targets` and a `result` proposal that keeps every valid trigger, the widest scope that still holds, and the evidence of all sources. Sources move one step down: active to superseded, superseded or legacy to archived. Never merge legacy with non-legacy memories; a cluster of legacy memories becomes one legacy memory and needs `legacy_reason`.
4. File `retopic` for a memory filed under a misleading topic.
5. Report the clusters you chose not to merge and why.

Every action waits for the user in the audit UI. End with the number of actions filed and the `ui` address.
```

`skills/clean/SKILL.md`

```markdown
---
name: clean
description: Review archived DD memories and file restore and delete actions. Use for /dd:clean, or when DD says the archive passed its review threshold.
---

# Clean the DD archive

1. `list` with `lifecycle_state: archived`; `get` each for its `archived_reason`.
2. Decide per memory: still useful for current work (restore) or not (delete). A memory archived as "merged into <id>" is kept only if the merge result lost something it said.
3. File at most one `act` of kind `restore` and one of kind `delete`, each listing its ids, with a rationale that names the rule you applied. Restore fails for a memory whose topic is taken; mention those instead of filing them.
4. Show the user the two lists before ending.

Deletion is permanent once the user applies it in the audit UI. End with the `ui` address.
```

`skills/prospect/SKILL.md`

```markdown
---
name: prospect
description: Search one area of the project for knowledge worth saving in DD, without repeating what is stored. Use for /dd:prospect <what to look at>.
---

# Prospect for DD knowledge

Arguments: the area, topic or question to explore.

1. Explore that area: the code, its tests, its docs and its recent history (`git log` for the paths involved).
2. For each candidate lesson, decision, procedure or trap, call `similar` with its text and `retrieve` with the action it applies to.
3. If an existing memory already says it, skip it. If one says it partly or less accurately, `propose` with that memory's `topic_key` to revise it. Otherwise `propose` a new memory.
4. Keep only what an agent reading the code would miss: why not the obvious approach, traps, values that look valid but are not, steps nothing enforces. Cite file evidence.

End with what you filed, what you skipped as already known, and the `ui` address.
```

`skills/init/SKILL.md`

```markdown
---
name: init
description: First deep survey of a project for DD knowledge; expensive. Use for /dd:init on a project that has little or no DD knowledge.
---

# Initialize DD knowledge

Before exploring anything, tell the user: a full survey reads much of the repository and can cost a lot of model usage; for one area, `/dd:prospect <area>` is cheaper. Call `status`; if the project already has active memories, say how many. Then ask whether to continue and stop until the user answers yes.

On a yes, survey in passes, and after each pass file what it found with `propose` (with file evidence) before starting the next:
1. Manifests, build, test and release commands, and what is non-obvious about them.
2. Architecture: module boundaries, the direction of dependencies, entry points.
3. Conventions visible in code and config that a newcomer would break.
4. Decisions and their reasons: docs, ADRs, README sections, commit messages that explain a choice.
5. Traps: workarounds, TODO/FIXME with context, platform-specific code, values that look valid but are not.
6. Testing and release procedures nothing enforces.

Before each proposal, check `similar` so nothing is filed twice. Keep only what an agent reading the code would miss. End with a summary per pass (filed, skipped) and the `ui` address; nothing is active until the user reviews it.
```

Update `skills/audit/SKILL.md` to mention the Actions panel and that `act` files requests while the UI applies them.

- [ ] **Step 4: Run** — `node --test tests/skills/skills.test.js && npm test` → PASS. Check with `grok plugin validate .` that Grok still discovers `skills/`.
- [ ] **Step 5: Commit** — `feat(skills): /dd commands for review, compact, clean, prospect and init`

---

### Task 11: Contract documents

**Files:**
- Modify: `docs/DD.md`, `README.md`, `docs/architecture/invariants.md`, `docs/memory/roadmap.md`

- [ ] **Step 1:** `docs/DD.md`: add to the contract list — actions are requests filed by the agent and applied only in the audit UI, all-or-nothing, refused when a target changed since filing; `legacy` memories warn the agent only when nothing current covers the same ground; every archived memory states why; a reviewer can request a revision with a reason, delivered to the agent on its next prompt or session start.
- [ ] **Step 2:** `README.md`: a "Managing memory from chat" section listing the eight `/dd:*` commands (one line each), the Actions panel, revision requests and the lifecycle table from the spec; update "Knowledge lifecycle" for `legacy`.
- [ ] **Step 3:** `docs/architecture/invariants.md`: add "An action changes nothing until a person applies it; applying it checks every target against the snapshot taken at filing." and "Legacy knowledge is recalled only as a warning and never outranks current knowledge."
- [ ] **Step 4:** Verify: `npm test`, `npm run test:stress`, `npm run eval`.
- [ ] **Step 5: Commit** — `docs: actions, legacy state and memory commands`

---

## Self-review notes

- Spec coverage: lifecycle table and legacy fields (T1–T3), archive reasons (T2, T5, T8), legacy recall rule B (T3), `act` and eight kinds (T4–T5, T7), storage and audit log (T1, T5), UI apply/reject/revise and stale (T5, T8), revision requests for memories and actions with hook delivery and `revises` (T6), never auto-accepted (T6 test), archive review prompt (T9), commands, plugin rename, `similar` (T7, T10), docs (T11).
- A merge result always names its `topic_key` (every proposal must); it is refused when a memory outside the merge holds it (T5). The spec says the same.
