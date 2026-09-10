# Memory deterioration detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect SuperMem live-set deterioration from SQLite counts and retrieval telemetry, with no LLM and no git writes.

**Architecture:** Pure function `assessDeterioration(snapshot, now, thresholds)` scores layer A (atoms) and layer B (retrieval events). SQLite loads a compact snapshot (no `payload`). MCP `supermem_health` and CLI `health` print the report. Detection never calls `retrieveMemories`.

**Tech Stack:** Node 22+, `node:test`, `node:sqlite`, existing `contentTokens` in `src/engine/v4/trigger-match.js`.

**Spec:** `docs/specs/2026-09-10-memory-deterioration-detection.md`

**Tests catalog:** `docs/specs/2026-09-10-memory-quality-and-performance-tests.md` — every `cut` row is a merge blocker for this plan. `gate` and `stress` must remain green. `later` is out of scope.

## Global Constraints

- Detection-only: no archive/reject/update of atoms.
- No LLM.
- No git writes; do not call `retrieveMemories`.
- Live set = `active` + `contested`.
- Layer B skipped when retrieval window has fewer than 10 events.
- Overall status = worst of non-skipped indicators (`deteriorated` > `watch` > `healthy`).
- Thresholds must match the spec exactly (copied below).
- Offenders arrays cap at 20.
- `now` is injectable.
- Node `>=22`. Tests: `node --test --test-concurrency=1`.
- Follow existing ESM, no TypeScript.

**Thresholds (verbatim from spec):**

```js
export const DEFAULT_HEALTH_THRESHOLDS = {
  live_bloat: { watch: 80, deteriorated: 200 },
  prefix_crowding: { depth: 2, watch: 12, deteriorated: 25 },
  trigger_collision: { jaccard: 0.5, watch: 1, deteriorated: 8 },
  dead_inferred: { min_age_days: 14, watch: 5, deteriorated: 20 },
  unresolved_contest: { min_age_days: 7, watch: 1, deteriorated: 3 },
  supersession_churn: { watch: 3, deteriorated: 5 },
  cap_saturation: { window: 50, min_events: 10, watch: 0.2, deteriorated: 0.5 },
};
```

**Report type (all tasks produce/consume this shape):**

```js
// assessDeterioration(snapshot, nowIso, thresholds?) =>
({
  project_id: string,
  generated_at: string, // nowIso
  status: 'healthy' | 'watch' | 'deteriorated',
  live: {
    active: number,
    contested: number,
    candidate: number,
    superseded: number,
    archived: number,
    rejected: number,
    total: number,
  },
  indicators: Array<{
    id: string,
    layer: 'store' | 'retrieve',
    status: 'healthy' | 'watch' | 'deteriorated' | 'skipped',
    value: number,
    watch_at: number,
    deteriorated_at: number,
    reason?: string,
    offenders: unknown[],
  }>,
  observations: { unreviewed: number, oldest_at: string | null },
})
```

**Snapshot type:**

```js
({
  project_id: string,
  atoms: Array<{
    id: string,
    topic_key: string,
    trigger: string,
    authority: string,
    lifecycle_state: string,
    activation_count: number,
    created_at: string,
    contested_at: string | null,
  }>,
  retrieval_events: Array<{ returned_atom_ids: string[], created_at: string }>,
  observations: { unreviewed: number, oldest_at: string | null },
})
```

---

### Task 1: Rollup, Jaccard, default thresholds

**Files:**
- Create: `src/engine/health/deterioration.js`
- Create: `tests/engine/health/deterioration.test.js`

**Interfaces:**
- Consumes: `contentTokens` from `src/engine/v4/trigger-match.js`
- Produces: `DEFAULT_HEALTH_THRESHOLDS`, `topicPrefix(topicKey, depth)`, `triggerJaccard(a, b)`, `indicatorStatus(value, watch, deteriorated)`, `overallStatus(indicators)`, `emptySnapshot(projectId)`, `assessDeterioration(snapshot, nowIso, thresholds)` (stub that only fills `live` counts + empty indicators is OK if tests for Jaccard/rollup live here; full indicators land in Task 2–3 — **this task must export the helpers and a rollup that already works**. `assessDeterioration` may return `indicators: []` and `status: 'healthy'` until Task 2. Prefer implementing helpers now and calling them from `assessDeterioration` starting Task 2.)

- [ ] **Step 1: Write the failing test**

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_HEALTH_THRESHOLDS,
  topicPrefix,
  triggerJaccard,
  indicatorStatus,
  overallStatus,
} from '../../../src/engine/health/deterioration.js';

describe('deterioration helpers', () => {
  test('default thresholds match the spec', () => {
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.live_bloat.watch, 80);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.live_bloat.deteriorated, 200);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.prefix_crowding.depth, 2);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.trigger_collision.jaccard, 0.5);
    assert.equal(DEFAULT_HEALTH_THRESHOLDS.cap_saturation.min_events, 10);
  });

  test('topicPrefix uses the first depth segments', () => {
    assert.equal(topicPrefix('memory/admission/required-fields', 2), 'memory/admission');
    assert.equal(topicPrefix('memory/admission', 2), 'memory/admission');
  });

  test('triggerJaccard ignores stopwords and does not treat substring as 1', () => {
    const score = triggerJaccard('before writing durable memory', 'before writing tests');
    assert.ok(Math.abs(score - 1 / 4) < 1e-9);
    assert.ok(triggerJaccard('editing migrations', 'when editing migrations on postgres') < 1);
  });

  test('triggerJaccard is 1 for identical content tokens', () => {
    assert.equal(triggerJaccard('writing durable memory', 'writing durable memory'), 1);
  });

  test('indicatorStatus and overallStatus rank deteriorated > watch > healthy and ignore skipped', () => {
    assert.equal(indicatorStatus(79, 80, 200), 'healthy');
    assert.equal(indicatorStatus(80, 80, 200), 'watch');
    assert.equal(indicatorStatus(200, 80, 200), 'deteriorated');
    assert.equal(overallStatus([
      { status: 'skipped' },
      { status: 'healthy' },
      { status: 'watch' },
    ]), 'watch');
    assert.equal(overallStatus([
      { status: 'watch' },
      { status: 'deteriorated' },
    ]), 'deteriorated');
    assert.equal(overallStatus([{ status: 'skipped' }]), 'healthy');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js`

Expected: FAIL with `Cannot find module` or `triggerJaccard is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
import { contentTokens } from '../v4/trigger-match.js';

export const DEFAULT_HEALTH_THRESHOLDS = {
  live_bloat: { watch: 80, deteriorated: 200 },
  prefix_crowding: { depth: 2, watch: 12, deteriorated: 25 },
  trigger_collision: { jaccard: 0.5, watch: 1, deteriorated: 8 },
  dead_inferred: { min_age_days: 14, watch: 5, deteriorated: 20 },
  unresolved_contest: { min_age_days: 7, watch: 1, deteriorated: 3 },
  supersession_churn: { watch: 3, deteriorated: 5 },
  cap_saturation: { window: 50, min_events: 10, watch: 0.2, deteriorated: 0.5 },
};

export function topicPrefix(topicKey, depth = 2) {
  return String(topicKey ?? '').split('/').filter(Boolean).slice(0, depth).join('/');
}

export function triggerJaccard(a, b) {
  const left = new Set(contentTokens(a));
  const right = new Set(contentTokens(b));
  if (left.size === 0 && right.size === 0) return 0;
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  const union = left.size + right.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function indicatorStatus(value, watch, deteriorated) {
  if (value >= deteriorated) return 'deteriorated';
  if (value >= watch) return 'watch';
  return 'healthy';
}

export function overallStatus(indicators = []) {
  let worst = 'healthy';
  for (const row of indicators) {
    if (row.status === 'deteriorated') return 'deteriorated';
    if (row.status === 'watch') worst = 'watch';
  }
  return worst;
}

export function emptySnapshot(projectId) {
  return {
    project_id: projectId,
    atoms: [],
    retrieval_events: [],
    observations: { unreviewed: 0, oldest_at: null },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/health/deterioration.js tests/engine/health/deterioration.test.js
git commit -m "feat: deterioration helpers and status rollup"
```

---

### Task 2: Layer A indicators

**Files:**
- Modify: `src/engine/health/deterioration.js`
- Modify: `tests/engine/health/deterioration.test.js`

**Interfaces:**
- Consumes: Task 1 helpers; snapshot `atoms`
- Produces: `assessDeterioration(snapshot, nowIso, thresholds = DEFAULT_HEALTH_THRESHOLDS)` with layer A indicators `live_bloat`, `prefix_crowding`, `trigger_collision`, `dead_inferred`, `unresolved_contest`, `supersession_churn`. Layer B may still be missing (add in Task 3). If B is absent, overall status uses A only.

Helper to keep dates testable:

```js
function ageDays(iso, nowIso) {
  return (Date.parse(nowIso) - Date.parse(iso)) / 86400000;
}

function live(atom) {
  return atom.lifecycle_state === 'active' || atom.lifecycle_state === 'contested';
}
```

- [ ] **Step 1: Write the failing tests** (append to the existing describe)

```js
import { assessDeterioration, emptySnapshot } from '../../../src/engine/health/deterioration.js';

const NOW = '2026-09-10T00:00:00.000Z';

function atom(overrides = {}) {
  return {
    id: 'a1',
    topic_key: 'memory/admission/required-fields',
    trigger: 'before writing durable memory',
    authority: 'inferred',
    lifecycle_state: 'active',
    activation_count: 1,
    created_at: '2026-09-09T00:00:00.000Z',
    contested_at: null,
    ...overrides,
  };
}

describe('assessDeterioration layer A', () => {
  test('three live non-colliding lessons are healthy with no retrieve events', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'a', topic_key: 'memory/admission/required-fields', trigger: 'before writing durable memory' }),
      atom({ id: 'b', topic_key: 'git/hooks/pre-commit', trigger: 'when installing git hooks' }),
      atom({ id: 'c', topic_key: 'ui/audit/form-fields', trigger: 'when editing audit form fields' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    assert.equal(report.status, 'healthy');
    assert.equal(report.live.active, 3);
    assert.equal(report.project_id, 'demo');
    assert.equal(report.generated_at, NOW);
  });

  test('30 live atoms under memory/admission trip prefix_crowding to deteriorated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = Array.from({ length: 30 }, (_, i) => atom({
      id: `p${i}`,
      topic_key: `memory/admission/item-${i}`,
      trigger: `when admitting memory item ${i}`,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const crowding = report.indicators.find(row => row.id === 'prefix_crowding');
    assert.equal(crowding.status, 'deteriorated');
    assert.equal(crowding.value, 30);
    assert.equal(report.status, 'deteriorated');
  });

  test('before writing durable memory vs before writing tests do not collide', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'a', trigger: 'before writing durable memory', topic_key: 'memory/admission/a' }),
      atom({ id: 'b', trigger: 'before writing tests', topic_key: 'memory/admission/b' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const collision = report.indicators.find(row => row.id === 'trigger_collision');
    assert.equal(collision.status, 'healthy');
    assert.equal(collision.value, 0);
  });

  test('shared content tokens at jaccard 0.5 count as a colliding pair', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'a', trigger: 'writing durable memory tests', topic_key: 'memory/admission/a' }),
      atom({ id: 'b', trigger: 'writing durable unit tests', topic_key: 'memory/admission/b' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const collision = report.indicators.find(row => row.id === 'trigger_collision');
    assert.equal(collision.status, 'watch');
    assert.equal(collision.value, 1);
    assert.equal(collision.offenders.length, 1);
  });

  test('dead inferred requires 14 days, zero activations, and inferred/observed only', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'old', activation_count: 0, created_at: '2026-08-01T00:00:00.000Z', authority: 'inferred' }),
      atom({ id: 'canon', activation_count: 0, created_at: '2026-08-01T00:00:00.000Z', authority: 'canonical', topic_key: 'memory/admission/canon' }),
      atom({ id: 'fresh', activation_count: 0, created_at: '2026-09-09T00:00:00.000Z', authority: 'inferred', topic_key: 'memory/admission/fresh' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const dead = report.indicators.find(row => row.id === 'dead_inferred');
    assert.equal(dead.value, 1);
    assert.deepEqual(dead.offenders.map(row => row.id ?? row), ['old']);
  });

  test('unresolved contest uses contested_at age', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({
        id: 'c1',
        lifecycle_state: 'contested',
        contested_at: '2026-08-01T00:00:00.000Z',
        topic_key: 'memory/admission/c1',
      }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const contest = report.indicators.find(row => row.id === 'unresolved_contest');
    assert.equal(contest.status, 'watch');
    assert.equal(contest.value, 1);
  });

  test('five superseded atoms on one topic_key are churn deteriorated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      atom({ id: 'live' }),
      ...Array.from({ length: 5 }, (_, i) => atom({
        id: `s${i}`,
        lifecycle_state: 'superseded',
        topic_key: 'memory/admission/required-fields',
      })),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const churn = report.indicators.find(row => row.id === 'supersession_churn');
    assert.equal(churn.status, 'deteriorated');
    assert.equal(churn.value, 5);
  });

  test('live_bloat counts only active+contested', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [
      ...Array.from({ length: 80 }, (_, i) => atom({ id: `a${i}`, topic_key: `synth/load/item-${i}`, trigger: `module ${i} tests` })),
      atom({ id: 's', lifecycle_state: 'superseded', topic_key: 'synth/load/old' }),
    ];
    const report = assessDeterioration(snapshot, NOW);
    const bloat = report.indicators.find(row => row.id === 'live_bloat');
    assert.equal(bloat.value, 80);
    assert.equal(bloat.status, 'watch');
  });
});
```

For the Jaccard 0.5 case: `writing durable memory tests` tokens `{writing, durable, memory, tests}` and `writing durable unit tests` tokens `{writing, durable, unit, tests}` → intersection 3, union 5, Jaccard 0.6 which is `>= 0.5`. That is enough. If the implementer wants exactly 0.5, use two 2-token triggers that share one token: `writing durable` vs `writing tests` → 1/3 < 0.5. Use two 2-token sets sharing one: wait 1/3. Two 4-token sets sharing 2 = 0.5: `writing durable memory extra` vs `writing durable other stuff` → `{writing,durable,memory,extra}` vs `{writing,durable,other,stuff}` inter 2 union 6 = 0.33. Simplest 0.5: `{a,b}` vs `{a,c}` is 1/3. `{a,b}` vs `{a,b,c}` = 2/3. **Use the 0.6 pair in the test above** (`>= 0.5` is the spec). Do not require exact 0.5.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js`

Expected: FAIL `assessDeterioration is not a function` or `report.indicators` empty.

- [ ] **Step 3: Write minimal implementation**

Implement `assessDeterioration` in `src/engine/health/deterioration.js`:

1. Count `live` by `lifecycle_state`.
2. Push six A indicators. Cap `offenders` at 20.
3. `dead_inferred` offenders: `{ id, topic_key, created_at }`.
4. `trigger_collision` offenders: `{ id_a, id_b, jaccard }` (round jaccard to 3 decimals).
5. `prefix_crowding` offenders: `{ prefix, count }`.
6. `supersession_churn` offenders: `{ topic_key, count }`.
7. `status = overallStatus(indicators)`, `generated_at = nowIso`, copy `observations` from snapshot (default zeros).
8. Only pair live atoms for collisions. Only live atoms for bloat, crowding, dead, contest. Churn counts `superseded` per `topic_key`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/health/deterioration.js tests/engine/health/deterioration.test.js
git commit -m "feat: layer A store-shape deterioration indicators"
```

---

### Task 3: Layer B cap saturation

**Files:**
- Modify: `src/engine/health/deterioration.js`
- Modify: `tests/engine/health/deterioration.test.js`

**Interfaces:**
- Consumes: `snapshot.retrieval_events` already newest-first or sort by `created_at` desc inside assess; take `thresholds.cap_saturation.window`
- Produces: indicator `{ id: 'cap_saturation', layer: 'retrieve', ... }` appended to `indicators`

- [ ] **Step 1: Write the failing tests**

```js
describe('assessDeterioration layer B', () => {
  test('fewer than 10 retrieval events skips cap_saturation and overall follows A', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [atom()];
    snapshot.retrieval_events = Array.from({ length: 9 }, (_, i) => ({
      returned_atom_ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
      created_at: `2026-09-10T00:00:0${i}.000Z`,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const cap = report.indicators.find(row => row.id === 'cap_saturation');
    assert.equal(cap.status, 'skipped');
    assert.equal(cap.reason, 'insufficient_telemetry');
    assert.equal(report.status, 'healthy');
  });

  test('10 events that each return 8 ids trip cap_saturation to deteriorated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.atoms = [atom()];
    snapshot.retrieval_events = Array.from({ length: 10 }, (_, i) => ({
      returned_atom_ids: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'],
      created_at: `2026-09-10T00:00:${String(i).padStart(2, '0')}.000Z`,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const cap = report.indicators.find(row => row.id === 'cap_saturation');
    assert.equal(cap.status, 'deteriorated');
    assert.equal(cap.value, 1);
    assert.equal(report.status, 'deteriorated');
  });

  test('abstentions do not count as saturated', () => {
    const snapshot = emptySnapshot('demo');
    snapshot.retrieval_events = Array.from({ length: 10 }, () => ({
      returned_atom_ids: [],
      created_at: NOW,
    }));
    const report = assessDeterioration(snapshot, NOW);
    const cap = report.indicators.find(row => row.id === 'cap_saturation');
    assert.equal(cap.status, 'healthy');
    assert.equal(cap.value, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js`

Expected: FAIL on missing `cap_saturation` indicator.

- [ ] **Step 3: Write minimal implementation**

After A indicators, take `events = snapshot.retrieval_events.slice().sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, window)`. If `events.length < min_events`, push skipped indicator with `value: 0`. Else `value = saturated/events.length` where saturated means `returned_atom_ids.length >= 8`. Use `indicatorStatus(value, 0.2, 0.5)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/health/deterioration.js tests/engine/health/deterioration.test.js
git commit -m "feat: cap_saturation retrieve-layer confirmation"
```

---

### Task 4: SQLite compact snapshot

**Files:**
- Modify: `src/store/sqlite-index.js` (add `loadHealthSnapshot(projectId)` next to `countByLifecycle`)
- Modify: `src/store/create-store.js` (export `loadHealthSnapshot`)
- Create: `tests/store/health-snapshot.test.js`

**Interfaces:**
- Consumes: existing `memory_atoms`, `memory_retrieval_events`, `memory_observations` tables
- Produces: `index.loadHealthSnapshot(projectId)` → snapshot object for `assessDeterioration`. Retrieval events newest-first, max 50. `returned_atom_ids` parsed from JSON text. Atom rows **must not** include `payload`, `what`, `why`, or `evidence_refs`.

SQL:

```sql
SELECT id, topic_key, trigger, authority, lifecycle_state, activation_count, created_at, contested_at
FROM memory_atoms WHERE project_id = ?

SELECT returned_atom_ids, created_at
FROM memory_retrieval_events
WHERE project_id = ?
ORDER BY created_at DESC
LIMIT 50

SELECT COUNT(*) AS n, MIN(observed_at) AS oldest
FROM memory_observations
WHERE project_id = ? AND promotion_status = 'unreviewed'
```

- [ ] **Step 1: Write the failing test**

```js
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';

describe('health snapshot', () => {
  test('loads compact atom columns and retrieval events without payload', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-health-'));
    const store = await createMemoryStore({
      supermemDir: join(root, '.supermem'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom({
      id: 'atom-1',
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/admission/required-fields',
      tags: ['memory'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
      evidence_refs: [{ source_type: 'file', source_ref: 'secret-path.js', summary: 'gate' }],
    });
    await store.logRetrieval({
      project_id: 'demo',
      action: 'before writing durable memory',
      intent: 'temporal',
      returned_atom_ids: ['atom-1'],
      abstained: false,
      budget_used: 10,
    });
    await store.putObservation({
      project_id: 'demo',
      source_type: 'tool_output',
      source_ref: 'edit',
      raw_preview: 'unreviewed note',
      promotion_status: 'unreviewed',
    });
    const snapshot = await store.loadHealthSnapshot('demo');
    assert.equal(snapshot.project_id, 'demo');
    assert.equal(snapshot.atoms[0].id, 'atom-1');
    assert.equal(snapshot.atoms[0].payload, undefined);
    assert.equal(snapshot.atoms[0].what, undefined);
    assert.equal(snapshot.atoms[0].evidence_refs, undefined);
    assert.deepEqual(snapshot.retrieval_events[0].returned_atom_ids, ['atom-1']);
    assert.equal(snapshot.observations.unreviewed, 1);
    assert.ok(snapshot.observations.oldest_at);
    store.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/store/health-snapshot.test.js`

Expected: FAIL `loadHealthSnapshot is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add `loadHealthSnapshot` on the sqlite index; wrap in `create-store.js` as `loadHealthSnapshot: projectId => Promise.resolve(index.loadHealthSnapshot(projectId))`. Parse `returned_atom_ids` with `JSON.parse`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 tests/store/health-snapshot.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sqlite-index.js src/store/create-store.js tests/store/health-snapshot.test.js
git commit -m "feat: sqlite compact snapshot for health detection"
```

---

### Task 5: Store assessDeterioration without retrieve or git writes

**Files:**
- Modify: `src/store/create-store.js`
- Modify: `tests/store/health-snapshot.test.js`

**Interfaces:**
- Consumes: `loadHealthSnapshot`, `assessDeterioration` from `src/engine/health/deterioration.js`, `store.loadConfig()` for optional `config.health` override (merge shallow over `DEFAULT_HEALTH_THRESHOLDS`)
- Produces: `store.assessDeterioration(projectId, { now } = {})` → report

- [ ] **Step 1: Write the failing tests**

```js
import { readFile } from 'node:fs/promises';

test('store.assessDeterioration does not dirty git or bump activation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supermem-health-'));
  const store = await createMemoryStore({
    supermemDir: join(root, '.supermem'),
    dataDir: join(root, 'data'),
  });
  await store.putAtom({
    id: 'atom-1',
    project_id: 'demo',
    memory_type: 'lesson',
    scope: 'project',
    title: 'Require trigger',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first',
    what: 'Durable memory needs a trigger.',
    why: 'Stops V1 dumps.',
    authority: 'inferred',
    confidence: 0.8,
    valid_from: '2026-09-09T00:00:00.000Z',
    topic_key: 'memory/admission/required-fields',
    tags: ['memory'],
    lifecycle_state: 'active',
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
  });
  const gitPath = join(root, '.supermem', 'atoms', 'memory', 'admission', 'required-fields.json');
  const before = await readFile(gitPath, 'utf8');
  const report = await store.assessDeterioration('demo', { now: '2026-09-10T00:00:00.000Z' });
  assert.equal(report.status, 'healthy');
  assert.equal(report.indicators.some(row => row.id === 'cap_saturation' && row.status === 'skipped'), true);
  const after = await readFile(gitPath, 'utf8');
  assert.equal(after, before);
  const atom = await store.getAtom('atom-1', 'demo');
  assert.equal(atom.activation_count ?? 0, 0);
  store.close();
});
```

Do **not** import `retrieveMemories` in production `assessDeterioration`. The test proves activation stayed 0, which would fail if someone reused retrieve.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/store/health-snapshot.test.js`

Expected: FAIL `assessDeterioration is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
import { assessDeterioration, DEFAULT_HEALTH_THRESHOLDS } from '../engine/health/deterioration.js';

async function assessProjectDeterioration({ now } = {}) {
  const snapshot = index.loadHealthSnapshot(projectIdFromCaller);
  // project id is an argument:
}
```

On the MemoryStore object, the method must take `projectId`:

```js
async function assessDeteriorationFor(projectId, { now } = {}) {
  const snapshot = index.loadHealthSnapshot(projectId);
  const config = await git.loadConfig();
  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS, ...(config.health ?? {}) };
  if (config.health?.live_bloat) thresholds.live_bloat = { ...DEFAULT_HEALTH_THRESHOLDS.live_bloat, ...config.health.live_bloat };
  // simpler: nested merge only for known keys
  return assessDeterioration(snapshot, now ?? new Date().toISOString(), thresholds);
}
```

Export as `assessDeterioration: (projectId, opts) => assessDeteriorationFor(projectId, opts)`.

MCP/CLI in Task 6 pass the bound project id.

Deep-merge helper (keep tiny):

```js
function healthThresholdsFromConfig(config) {
  const base = structuredClone(DEFAULT_HEALTH_THRESHOLDS);
  const override = config?.health;
  if (!override) return base;
  for (const key of Object.keys(base)) {
    if (override[key] && typeof override[key] === 'object') Object.assign(base[key], override[key]);
  }
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-concurrency=1 tests/store/health-snapshot.test.js tests/engine/health/deterioration.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/create-store.js tests/store/health-snapshot.test.js
git commit -m "feat: store.assessDeterioration read-only health report"
```

---

### Task 6: MCP `supermem_health` and CLI `health`

**Files:**
- Modify: `src/mcp/tools.js` (add handler after `supermem_status`)
- Modify: `src/mcp/server.js` (register tool)
- Modify: `src/cli.js` (command `health`)
- Modify: `tests/mcp/tools.test.js`
- Modify: `src/store/paths.js` (`DEFAULT_CONFIG.health = DEFAULT_HEALTH_THRESHOLDS` copy)

**Interfaces:**
- Consumes: `store.assessDeterioration(projectId, { now })`
- Produces: MCP tool `supermem_health` with empty input schema; CLI `node src/cli.js health` prints JSON

- [ ] **Step 1: Write the failing MCP test** (append to `tests/mcp/tools.test.js`)

```js
test('health reports healthy empty project without retrieve', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supermem-health-'));
  const store = await createMemoryStore({
    supermemDir: join(root, '.supermem'),
    dataDir: join(root, 'data'),
  });
  const tools = createToolHandlers({ store, projectId: 'demo', uiPort: 7733 });
  const health = JSON.parse((await tools.supermem_health()).content[0].text);
  assert.equal(health.status, 'healthy');
  assert.equal(health.live.total, 0);
  assert.ok(health.indicators.some(row => row.id === 'live_bloat'));
  store.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-concurrency=1 tests/mcp/tools.test.js`

Expected: FAIL `tools.supermem_health is not a function`.

- [ ] **Step 3: Write minimal implementation**

`tools.js`:

```js
async supermem_health() {
  const report = await store.assessDeterioration(projectId);
  return jsonResult(report);
},
```

`server.js` after `supermem_status`:

```js
server.registerTool('supermem_health', {
  description: 'Detect live-set deterioration from store counts and retrieve telemetry. Advisory, no writes.',
  inputSchema: {},
}, async () => tools.supermem_health());
```

`cli.js` after `status`:

```js
if (command === 'health') {
  const report = await store.assessDeterioration(projectId);
  console.log(JSON.stringify(report, null, 2));
  store.close();
  return;
}
```

`paths.js` DEFAULT_CONFIG add `health` object equal to spec thresholds (import or duplicate the numbers; duplicating the numbers in `paths.js` is OK if engine remains source of truth — prefer importing `DEFAULT_HEALTH_THRESHOLDS` from `deterioration.js` into `paths.js` to avoid drift).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test --test-concurrency=1 tests/mcp/tools.test.js tests/engine/health/deterioration.test.js tests/store/health-snapshot.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.js src/mcp/server.js src/cli.js src/store/paths.js tests/mcp/tools.test.js
git commit -m "feat: supermem_health MCP tool and CLI health command"
```

---

### Task 7: Full suite + spec pointer

**Files:**
- Modify: `docs/specs/2026-09-09-retrieval-hot-path-and-scale.md` — in "Later", change the decay row to point at `docs/specs/2026-09-10-memory-deterioration-detection.md` (detection done in this plan; auto-archive still later)
- Modify: `package.json` only if a test glob needs `tests/engine/health/**` — current `tests/engine/**/*.test.js` already matches. Do not add health to `test:stress`.

- [ ] **Step 1: Run the full unit suite**

Run: `npm test`

Expected: PASS, including new health tests.

- [ ] **Step 2: Confirm retrieve glob still includes health**

`package.json` `test` script already uses `tests/engine/**/*.test.js`. No change if that is true.

- [ ] **Step 3: One-line later-table update in the hot-path spec**

Replace the decay row "Why later" with: `Auto-archive still later. Detection is spec 2026-09-10-memory-deterioration-detection.md.`

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-09-09-retrieval-hot-path-and-scale.md
git commit -m "docs: point decay follow-up at deterioration detection spec"
```

---

### Task 8: Catalog `cut` rows still missing after Tasks 1–7

**Files:**
- Modify: `tests/engine/health/deterioration.test.js`
- Modify: `tests/store/health-snapshot.test.js`
- Create: `tests/stress/health-scale.test.js`
- Modify: `package.json` — `test:stress` already globs `tests/stress/**/*.test.js`; no change if that is true.

**Interfaces:**
- Consumes: `assessDeterioration`, `emptySnapshot`, `store.assessDeterioration`, `store.loadHealthSnapshot`
- Produces: tests for catalog rows D18–D21 and P9–P13

Required catalog: `docs/specs/2026-09-10-memory-quality-and-performance-tests.md`. After this task, every row with status `cut` must exist and pass.

- [ ] **Step 1: Write the failing tests**

Append to `tests/engine/health/deterioration.test.js`:

```js
test('observation backlog does not flip status (D18)', () => {
  const snapshot = emptySnapshot('demo');
  snapshot.atoms = [atom()];
  snapshot.observations = { unreviewed: 100, oldest_at: '2026-01-01T00:00:00.000Z' };
  const report = assessDeterioration(snapshot, NOW);
  assert.equal(report.status, 'healthy');
  assert.equal(report.observations.unreviewed, 100);
});

test('offenders cap at 20 (D19)', () => {
  const snapshot = emptySnapshot('demo');
  snapshot.atoms = Array.from({ length: 40 }, (_, i) => atom({
    id: `c${i}`,
    topic_key: `synth/area${i}/item`,
    trigger: `unique trigger token${i} extra`,
  }));
  // 40 prefixes of count 1 do not crowd; force 40 colliding pairs instead:
  snapshot.atoms = Array.from({ length: 40 }, (_, i) => atom({
    id: `c${i}`,
    topic_key: `synth/load/item-${i}`,
    trigger: 'writing durable memory tests',
  }));
  const report = assessDeterioration(snapshot, NOW);
  const collision = report.indicators.find(row => row.id === 'trigger_collision');
  assert.ok(collision.offenders.length <= 20);
});

test('200 live distinct-trigger atoms assess in under 100ms (P9)', () => {
  const snapshot = emptySnapshot('demo');
  snapshot.atoms = Array.from({ length: 200 }, (_, i) => atom({
    id: `n${i}`,
    topic_key: `synth/load/item-${i}`,
    trigger: `when running unique module ${i} suite`,
  }));
  const started = Date.now();
  const report = assessDeterioration(snapshot, NOW);
  const elapsed = Date.now() - started;
  assert.equal(report.live.active, 200);
  assert.ok(elapsed < 100, `assessed 200 live in ${elapsed}ms`);
});
```

Append to `tests/store/health-snapshot.test.js`:

```js
test('config health.live_bloat.watch override is honored (D20)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supermem-health-'));
  const store = await createMemoryStore({
    supermemDir: join(root, '.supermem'),
    dataDir: join(root, 'data'),
  });
  for (let i = 0; i < 5; i += 1) {
    await store.putAtom({
      id: `a${i}`,
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: `Lesson ${i}`,
      trigger: `when running unique module ${i} suite`,
      behavior_delta: 'keep isolation',
      what: `Fixture ${i}.`,
      why: `Isolation ${i}.`,
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: `synth/load/item-${i}`,
      tags: ['synth'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: `Synth ${i}.`, short: `Module ${i}.` },
    });
  }
  await store.saveConfig({ ...(await store.loadConfig()), health: { live_bloat: { watch: 3, deteriorated: 10 } } });
  const report = await store.assessDeterioration('demo', { now: '2026-09-10T00:00:00.000Z' });
  const bloat = report.indicators.find(row => row.id === 'live_bloat');
  assert.equal(bloat.status, 'watch');
  store.close();
});

test('fifty health runs do not bump activation or retrieval events (P12)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'supermem-health-'));
  const store = await createMemoryStore({
    supermemDir: join(root, '.supermem'),
    dataDir: join(root, 'data'),
  });
  await store.putAtom({
    id: 'atom-1',
    project_id: 'demo',
    memory_type: 'lesson',
    scope: 'project',
    title: 'Require trigger',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first',
    what: 'Durable memory needs a trigger.',
    why: 'Stops V1 dumps.',
    authority: 'inferred',
    confidence: 0.8,
    valid_from: '2026-09-09T00:00:00.000Z',
    topic_key: 'memory/admission/required-fields',
    tags: ['memory'],
    lifecycle_state: 'active',
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
  });
  for (let i = 0; i < 50; i += 1) {
    await store.assessDeterioration('demo', { now: '2026-09-10T00:00:00.000Z' });
  }
  const atom = await store.getAtom('atom-1', 'demo');
  assert.equal(atom.activation_count ?? 0, 0);
  const snapshot = await store.loadHealthSnapshot('demo');
  assert.equal(snapshot.retrieval_events.length, 0);
  store.close();
});
```

Create `tests/stress/health-scale.test.js`:

```js
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';

const CORPUS = 2000;
const NOW = '2026-09-10T00:00:00.000Z';

describe('health stress (2000 atoms)', { timeout: 120000 }, () => {
  let store;
  let gitPath;
  let gitBefore;

  before(async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-health-stress-'));
    store = await createMemoryStore({
      supermemDir: join(root, '.supermem'),
      dataDir: join(root, 'data'),
    });
    await store.putAtom({
      id: 'needle-demo',
      project_id: 'demo',
      memory_type: 'lesson',
      scope: 'project',
      title: 'Require trigger',
      trigger: 'before writing durable memory',
      behavior_delta: 'validate trigger first',
      what: 'Durable memory needs a trigger.',
      why: 'Stops V1 dumps.',
      authority: 'inferred',
      confidence: 0.8,
      valid_from: '2026-09-09T00:00:00.000Z',
      topic_key: 'memory/demo/required-fields',
      tags: ['memory'],
      lifecycle_state: 'active',
      retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
    });
    gitPath = join(root, '.supermem', 'atoms', 'memory', 'demo', 'required-fields.json');
    gitBefore = await readFile(gitPath, 'utf8');
    for (let i = 0; i < CORPUS; i += 1) {
      store.index.upsertAtom({
        id: `load-demo-${i}`,
        project_id: 'demo',
        memory_type: 'lesson',
        scope: 'project',
        title: `Synthetic ${i}`,
        trigger: `when running unit tests in module ${i}`,
        behavior_delta: `isolate fixture ${i}`,
        what: `Synthetic fixture ${i}.`,
        why: `Load-test isolation ${i}.`,
        authority: 'inferred',
        confidence: 0.7,
        valid_from: '2026-09-09T00:00:00.000Z',
        topic_key: `synth/demo/item-${i}`,
        tags: ['synth'],
        lifecycle_state: 'active',
        retrieval_forms: { micro: `Synth ${i}.`, short: `Run tests in module ${i}.` },
        created_at: '2026-09-09T00:00:00.000Z',
        updated_at: '2099-01-01T00:00:00.000Z',
      });
    }
  });

  after(() => store.close());

  test('assessDeterioration on 2000 live atoms finishes under 1s (P10)', async () => {
    const started = Date.now();
    const report = await store.assessDeterioration('demo', { now: NOW });
    const elapsed = Date.now() - started;
    assert.ok(report.live.active >= CORPUS);
    assert.ok(report.indicators.every(row => row.offenders.length <= 20));
    assert.ok(elapsed < 1000, `health 2000 took ${elapsed}ms`);
  });

  test('loadHealthSnapshot at 2000 atoms is under 200ms and compact (P11)', async () => {
    const started = Date.now();
    const snapshot = await store.loadHealthSnapshot('demo');
    const elapsed = Date.now() - started;
    assert.ok(snapshot.atoms.length >= CORPUS);
    assert.ok(snapshot.atoms.every(row => row.payload === undefined && row.what === undefined));
    assert.ok(elapsed < 200, `snapshot took ${elapsed}ms`);
  });

  test('health does not walk git (P13)', async () => {
    await store.assessDeterioration('demo', { now: NOW });
    const after = await readFile(gitPath, 'utf8');
    assert.equal(after, gitBefore);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test --test-concurrency=1 tests/engine/health/deterioration.test.js tests/store/health-snapshot.test.js tests/stress/health-scale.test.js`

Expected: FAIL until D18–D21 / P9–P13 behavior exists (config merge, offender cap, stress file).

- [ ] **Step 3: Implement the missing bits only**

- Offender cap 20 in every indicator builder.
- Shallow merge of `config.health[key]` onto `DEFAULT_HEALTH_THRESHOLDS[key]`.
- Do not call retrieve or putAtom from health.

- [ ] **Step 4: Run catalog gates**

```bash
npm test
npm run test:stress
```

Expected: PASS. Then tick every `cut` row in `docs/specs/2026-09-10-memory-quality-and-performance-tests.md` mentally; if any D* or P9–P13 has no test, add it before committing.

- [ ] **Step 5: Commit**

```bash
git add tests/engine/health/deterioration.test.js tests/store/health-snapshot.test.js tests/stress/health-scale.test.js src/engine/health/deterioration.js src/store/create-store.js
git commit -m "test: deterioration catalog cut rows and health scale"
```

---

## Self-review

**Spec coverage:**

| Spec item | Task |
|---|---|
| live_bloat | 2 |
| prefix_crowding | 2 |
| trigger_collision + Jaccard not substring-1 | 1, 2 |
| dead_inferred | 2 |
| unresolved_contest | 2 |
| supersession_churn | 2 |
| cap_saturation + skip < 10 | 3 |
| observation backlog not in status | 2 (pass-through), 4 |
| compact columns, no payload | 4 |
| no retrieveMemories / no git write | 5 |
| MCP + CLI | 6 |
| thresholds in config | 5, 6, 8 (D20) |
| observation backlog not flipping status | 8 (D18) |
| offenders cap 20 | 8 (D19) |
| detector performance P9–P13 | 8 |
| quality/performance catalog | `docs/specs/2026-09-10-memory-quality-and-performance-tests.md` |
| LLM prune / auto-archive / abstention F1 | out of scope (`later`) |

**Placeholders:** none.

**Type consistency:** `assessDeterioration(snapshot, nowIso, thresholds)` in engine; `store.assessDeterioration(projectId, { now })` on the store; MCP `supermem_health()` with no args.

Do not implement auto-prune, UI charts, or embeddings in any task.
