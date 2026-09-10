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
    const root = await mkdtemp(join(tmpdir(), 'dd-health-stress-'));
    store = await createMemoryStore({
      ddDir: join(root, '.dd'),
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
    gitPath = join(root, '.dd', 'atoms', 'memory', 'demo', 'required-fields.json');
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

  test('assessDeterioration on 2000 live atoms finishes under 1s', async () => {
    const started = Date.now();
    const report = await store.assessDeterioration('demo', { now: NOW });
    const elapsed = Date.now() - started;
    assert.ok(report.live.active >= CORPUS);
    assert.ok(report.indicators.every(row => row.offenders.length <= 20));
    assert.ok(elapsed < 1000, `health 2000 took ${elapsed}ms`);
  });

  test('loadHealthSnapshot at 2000 atoms is under 200ms and compact', async () => {
    const started = Date.now();
    const snapshot = await store.loadHealthSnapshot('demo');
    const elapsed = Date.now() - started;
    assert.ok(snapshot.atoms.length >= CORPUS);
    assert.ok(snapshot.atoms.every(row => row.payload === undefined && row.what === undefined));
    assert.ok(elapsed < 200, `snapshot took ${elapsed}ms`);
  });

  test('health does not walk git', async () => {
    await store.assessDeterioration('demo', { now: NOW });
    const after = await readFile(gitPath, 'utf8');
    assert.equal(after, gitBefore);
  });
});
