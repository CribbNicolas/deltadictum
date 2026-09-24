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

async function connect(t) {
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
  const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
  return { store, client, call };
}

// The agent can ask for store changes but never apply them.
test('act files pending actions; no tool applies them; status counts them', async t => {
  const { store, client, call } = await connect(t);
  const { tools } = await client.listTools();
  assert.ok(tools.some(x => x.name === 'act') && tools.some(x => x.name === 'similar'));
  assert.equal(tools.some(x => /apply|approve|admit/.test(x.name)), false);
  const filed = await call('act', { actions: [{ kind: 'archive', targets: ['m1'], archived_reason: 'Unused.', rationale: 'The user asked.' }] });
  assert.equal(filed.actions[0].status, 'pending');
  assert.equal((await store.getAtom('m1', 'demo')).lifecycle_state, 'active');
  const status = await call('status', {});
  assert.equal(status.pending_actions, 1);
  assert.deepEqual(status.revision_requests, []);
  assert.deepEqual(status.archive_review, { archived: 0, threshold: 50, due: false });
});

test('propose accepts revises', async t => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();
  const schema = tools.find(x => x.name === 'propose').inputSchema.properties.proposals.items;
  assert.ok(schema.properties.revises);
});
