import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createToolHandlers } from '../../src/mcp/tools.js';

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
  test('propose, list, admit, retrieve, delete', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-mcp-'));
    const store = await createMemoryStore({
      ddDir: join(root, '.dd'),
      dataDir: join(root, 'data'),
    });
    const tools = createToolHandlers({ store, projectId: 'demo', uiPort: 7733 });

    const proposed = JSON.parse((await tools.propose({ ...proposal(), project_id: 'demo' })).content[0].text);
    assert.equal(proposed.decision, 'write');

    const admitted = JSON.parse((await tools.admit({ id: proposed.atom.id })).content[0].text);
    assert.equal(admitted.lifecycle_state, 'active');

    const retrieved = JSON.parse((await tools.retrieve({ action: 'before writing durable memory' })).content[0].text);
    assert.equal(retrieved.abstained, false);
    assert.equal(retrieved.memories[0].content, 'Validate trigger before active memory.');
    assert.equal(retrieved.memories[0].evidence_refs, undefined);
    assert.ok(!JSON.stringify(retrieved).includes('src/engine/v2/admission.js'));
    const rawRetrieve = (await tools.retrieve({ action: 'before writing durable memory' })).content[0].text;
    assert.doesNotMatch(rawRetrieve, /\n\s+/);

    const listed = JSON.parse((await tools.list({})).content[0].text);
    assert.equal(listed.length, 1);

    const deleted = JSON.parse((await tools.delete({ id: proposed.atom.id })).content[0].text);
    assert.equal(deleted.deleted, true);
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

