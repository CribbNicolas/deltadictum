import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createToolHandlers } from '../../src/mcp/tools.js';
import { admitMemory, HUMAN_REVIEW } from '../../src/engine/lifecycle.js';

function proposal() {
  return {
    memory_type: 'lesson',
    title: 'Require trigger',
    trigger: 'before writing durable memory',
    behavior_delta: 'validate trigger first',
    what: 'Durable memory needs a trigger.',
    why: 'Stops V1 dumps.',
    topic_key: 'memory/admission/required-fields',
    evidence_refs: [{ source_type: 'file', source_ref: 'src/engine/v2/admission.js', summary: 'gate' }],
    retrieval_forms: { micro: 'Require trigger.', short: 'Validate trigger before active memory.' },
  };
}

describe('MCP tool handlers', () => {
  test('compact propose, local review, list and retrieve without agent approval tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-mcp-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const tools = createToolHandlers({ store, projectId: 'demo', uiPort: 7733 });

    const proposed = JSON.parse((await tools.propose({ proposals: [proposal()] })).content[0].text).proposals[0];
    assert.equal(proposed.decision, 'write');

    assert.equal(proposed.atom, undefined);
    assert.equal(tools.admit, undefined);
    assert.equal(tools.resolve, undefined);
    assert.equal(tools.delete, undefined);
    const admitted = await admitMemory(proposed.id, { store, projectId: 'demo', actor: HUMAN_REVIEW, rationale: 'Reviewed gate.' });
    assert.equal(admitted.lifecycle_state, 'active');

    const retrieved = JSON.parse((await tools.retrieve({ action: 'before writing durable memory' })).content[0].text);
    assert.equal(retrieved.abstained, false);
    assert.match(retrieved.memories[0].content, /validate trigger first/);
    assert.equal(retrieved.memories[0].evidence_refs, undefined);
    assert.ok(!JSON.stringify(retrieved).includes('src/engine/v2/admission.js'));
    const rawRetrieve = (await tools.retrieve({ action: 'before writing durable memory', repeat: true })).content[0].text;
    assert.doesNotMatch(rawRetrieve, /\n\s+/);
    // Engine bookkeeping is not knowledge; the agent sees only what it can act on.
    assert.deepEqual(Object.keys(retrieved).sort(), ['abstained', 'memories']);
    assert.deepEqual(Object.keys(retrieved.memories[0]).sort(), ['content', 'id', 'memory_type']);

    const expanded = JSON.parse((await tools.get({ id: proposed.id })).content[0].text);
    assert.equal(expanded.behavior_delta, 'validate trigger first');
    assert.equal(expanded.why, 'Stops V1 dumps.');
    assert.equal(expanded.trigger, 'before writing durable memory');
    // Duplicates of authored text and verification internals stay out of the default view.
    for (const field of ['retrieval_forms', 'what', 'evidence_state', 'project_id', 'registry_key_id', 'schema_version'])
      assert.equal(expanded[field], undefined, field);
    assert.equal(expanded.evidence_refs[0].source_ref, 'src/engine/v2/admission.js');
    assert.ok('status' in expanded.evidence_refs[0]);
    assert.equal(expanded.evidence_refs[0].hash, undefined);
    assert.ok(Array.isArray(expanded.freshness));
    const verbose = JSON.parse((await tools.get({ id: proposed.id, verbose: true })).content[0].text);
    assert.ok(verbose.retrieval_forms && verbose.evidence_state);
    assert.ok(JSON.stringify(expanded).length < JSON.stringify(verbose).length);

    const listed = JSON.parse((await tools.list({})).content[0].text);
    assert.equal(listed.total, 1);

    store.close();
  });

  test('status includes audit UI url', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-status-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const tools = createToolHandlers({ store, projectId: 'demo', uiPort: 7735 });
    const status = JSON.parse((await tools.status()).content[0].text);
    assert.equal(status.project_id, 'demo');
    assert.equal(status.ui_url, 'http://127.0.0.1:7735');
    assert.equal(status.total, 0);
    assert.deepEqual(status.counts, {});
    store.close();
  });

  test('health reports healthy empty project without retrieve', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-health-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const tools = createToolHandlers({ store, projectId: 'demo', uiPort: 7733 });
    const health = JSON.parse((await tools.health()).content[0].text);
    assert.equal(health.status, 'healthy');
    assert.equal(health.live.total, 0);
    assert.ok(health.indicators.some(row => row.id === 'live_bloat'));
    store.close();
  });
});
