import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMemoryStore } from '../../src/store/create-store.js';
import { createMcpServer } from '../../src/mcp/definition.js';
import { createToolHandlers } from '../../src/mcp/tools.js';

test('actual MCP schema has one compact proposal surface and no self-approval operations', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dd-protocol-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  const server = createMcpServer({ store, projectId: 'demo' });
  const client = new Client({ name: 'contract-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); store.close(); });
  const { tools } = await client.listTools();
  assert.equal(tools.some(t => ['admit', 'resolve', 'delete', 'reject'].includes(t.name)), false);
  assert.equal(tools.filter(t => ['propose', 'capture', 'update'].includes(t.name)).length, 1);
  const result = await client.callTool({ name: 'propose', arguments: { session_id: 'test', proposals: [{
    topic_key: 'test/contract/lesson', trigger: 'when writing tests', behavior_delta: 'Check behavior.', why: 'Prevent regressions.',
    evidence_refs: [{ source_type: 'file', source_ref: 'test.js', summary: 'Test evidence' }],
  }] } });
  assert.equal(result.isError, undefined);
  const data = JSON.parse(result.content[0].text);
  assert.equal(data.proposals[0].lifecycle_state, 'candidate');
  assert.equal(data.proposals[0].atom, undefined);
  assert.equal(data.proposals[0].capture_origin, 'user_explicit');
  assert.equal(data.proposals[0].capture_source, 'agent');

  const proposalSchema = tools.find(t => t.name === 'propose').inputSchema.properties.proposals.items;
  assert.equal(proposalSchema.properties.capture_source, undefined);
  const mixed = await client.callTool({ name: 'propose', arguments: { session_id: 'test', proposals: [
    { capture_origin: 'user_explicit', topic_key: 'test/contract/requested', trigger: 'when saving requested knowledge',
      behavior_delta: 'Record the request accurately.', why: 'Preserve capture intent.', capture_source: 'local_ui',
      evidence_refs: [{ source_type: 'user_statement', source_ref: 'current-request', summary: 'Please save this rule.' }] },
    { capture_origin: 'model_initiated', topic_key: 'test/contract/discovered', trigger: 'when saving discovered knowledge',
      behavior_delta: 'Record the observed pattern.', why: 'Make future work easier.',
      evidence_refs: [{ source_type: 'file', source_ref: 'test.js', summary: 'Test evidence' }] },
  ] } });
  assert.equal(mixed.isError, undefined);
  const captured = JSON.parse(mixed.content[0].text).proposals;
  assert.deepEqual(captured.map(p => p.capture_origin), ['user_explicit', 'model_initiated']);
  assert.ok(captured.every(p => p.capture_source === 'agent' && p.lifecycle_state === 'candidate'));
  const listed = await client.callTool({ name: 'list', arguments: { capture_origin: 'user_explicit', limit: 1 } });
  const page = JSON.parse(listed.content[0].text);
  assert.equal(page.total, 2);
  assert.equal(page.memories.length, 1);
  assert.equal(page.memories[0].id, captured[0].id);
  assert.equal(page.memories[0].capture_origin, 'user_explicit');
  const expanded = await client.callTool({ name: 'get', arguments: { id: captured[0].id } });
  assert.equal(JSON.parse(expanded.content[0].text).capture_source, 'agent');
  const invalid = await client.callTool({ name: 'propose', arguments: { proposals: [{
    capture_origin: 'unknown', topic_key: 'test/contract/invalid', trigger: 'when saving',
    behavior_delta: 'Validate origin.', why: 'No invented attribution.',
    evidence_refs: [{ source_type: 'file', source_ref: 'test.js', summary: 'Test evidence' }],
  }] } });
  assert.equal(invalid.isError, true);
  const bulk = await client.callTool({ name: 'propose', arguments: { session_id: 'test', proposals: Array.from({ length: 5 }, (_, i) => ({
    topic_key: `test/import/item-${i}`, trigger: `when importing decision ${i}`, behavior_delta: `Preserve decision ${i}.`,
    why: 'Keep project decisions reusable.', evidence_refs: [{ source_type: 'file', source_ref: 'decisions.md', summary: 'Source decisions' }],
  })) } });
  assert.equal(bulk.isError, undefined);
  const imported = JSON.parse(bulk.content[0].text).proposals;
  assert.equal(imported.length, 5);
  assert.ok(imported.every(p => p.decision === 'write' && p.lifecycle_state === 'candidate'));
  const empty = await client.callTool({ name: 'propose', arguments: { proposals: [] } });
  assert.equal(empty.isError, true);
});

test('every implemented handler is reachable and every advertised tool is implemented', async t => {
  // The audit that prompted this guard found an `update` handler that was fully
  // implemented and never registered, so no caller could reach it, and a
  // `propose` handler shadowed by a routing ternary. Both looked alive.
  const root = await mkdtemp(join(tmpdir(), 'dd-parity-'));
  const store = await createMemoryStore({ ddDir: join(root, '.dd'), dataDir: join(root, 'data') });
  const server = createMcpServer({ store, projectId: 'demo' });
  const client = new Client({ name: 'parity-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); store.close(); });

  const advertised = (await client.listTools()).tools.map(tool => tool.name).sort();
  const implemented = Object.keys(createToolHandlers({ store, projectId: 'demo' })).sort();
  assert.deepEqual(implemented, advertised,
    'a handler nobody can call, or a tool nobody implements, is the drift this test exists to catch');
});
