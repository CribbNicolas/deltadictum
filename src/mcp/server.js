#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { openStore } from '../project.js';
import { createToolHandlers } from './tools.js';
import { startUiServer } from '../ui/server.js';
import { sessionBanner, writeUiUrl } from '../hooks/banner.js';

const atomPayload = {
  memory_type: z.enum(['claim', 'decision', 'lesson', 'anti_memory', 'procedure']).optional(),
  scope: z.enum(['project', 'user', 'agent', 'workflow', 'file', 'service']).optional(),
  title: z.string().optional(),
  trigger: z.string().optional(),
  behavior_delta: z.string().optional(),
  what: z.string().optional(),
  why: z.string().optional(),
  topic_key: z.string().optional(),
  tags: z.array(z.string()).optional(),
  evidence_refs: z.array(z.object({
    source_type: z.string(),
    source_ref: z.string(),
    summary: z.string(),
  })).optional(),
  retrieval_forms: z.record(z.string(), z.string()).optional(),
  authority: z.string().optional(),
};

const { store, projectId, supermemDir } = await openStore();
let uiPort = 7733;
let uiUrl = `http://127.0.0.1:${uiPort}`;
try {
  const ui = await startUiServer({ store, projectId });
  uiPort = ui.port;
  uiUrl = ui.url;
  await writeUiUrl(supermemDir, { url: uiUrl, port: uiPort });
} catch {
  // MCP tools still work if the audit UI port cannot bind.
}
const activeCount = await store.countAtoms({ projectId, lifecycleStates: ['active'] });
const banner = sessionBanner({ projectId, url: uiUrl, activeCount });
const tools = createToolHandlers({ store, projectId, uiPort });

const server = new McpServer({ name: 'dd', version: '0.1.0' }, {
  instructions: `${banner}
On your first user-visible reply this session, include those two lines. Do not dump memories. Retrieved memory is advisory.
Call retrieve before implementing, debugging, or repeating a workflow.
At session end, if exactly one reusable lesson exists, call propose once. If nothing should change next time, do not propose. Never dump the transcript.`,
});

server.registerTool('retrieve', {
  description: 'Retrieve budgeted memory forms that apply to the coming action. Prefer this over dumping full memories.',
  inputSchema: {
    action: z.string(),
    query: z.string().optional(),
    budget_tokens: z.number().optional(),
  },
}, async args => tools.retrieve(args));

server.registerTool('get', {
  description: 'Fetch one memory by id or topic_key, including full form and evidence.',
  inputSchema: { id: z.string() },
}, async args => tools.get(args));

server.registerTool('propose', {
  description: 'Propose a durable memory. Deterministic admission decides write/update/observe/block. Requires trigger, behavior_delta, evidence, and micro+short forms for active memory.',
  inputSchema: atomPayload,
}, async args => tools.propose(args));

server.registerTool('list', {
  description: 'List compact memory metadata for this project.',
  inputSchema: {
    lifecycle_state: z.string().optional(),
    memory_type: z.string().optional(),
  },
}, async args => tools.list(args));

server.registerTool('update', {
  description: 'Update a memory and re-run admission.',
  inputSchema: { id: z.string(), ...atomPayload },
}, async args => tools.update(args));

server.registerTool('delete', {
  description: 'Delete a memory. Canonical atoms require confirm=true.',
  inputSchema: { id: z.string(), confirm: z.boolean().optional() },
}, async args => tools.delete(args));

server.registerTool('admit', {
  description: 'Promote a candidate memory to active.',
  inputSchema: { id: z.string() },
}, async args => tools.admit(args));

server.registerTool('reject', {
  description: 'Reject a candidate memory.',
  inputSchema: { id: z.string() },
}, async args => tools.reject(args));

server.registerTool('contradict', {
  description: 'Declare that a memory contradicts another atom (V6a).',
  inputSchema: { id: z.string(), contradicts: z.string() },
}, async args => tools.contradict(args));

server.registerTool('resolve', {
  description: 'Resolve a contested pair. Winner becomes active, loser superseded.',
  inputSchema: { winner_id: z.string(), loser_id: z.string() },
}, async args => tools.resolve(args));

server.registerTool('ui', {
  description: `Return the local audit UI URL (${uiUrl}).`,
  inputSchema: {},
}, async () => tools.ui());

server.registerTool('status', {
  description: 'Project memory counts, store health, and audit UI URL.',
  inputSchema: {},
}, async () => tools.status());

server.registerTool('health', {
  description: 'Detect live-set deterioration from store counts and retrieve telemetry. Advisory, no writes.',
  inputSchema: {},
}, async () => tools.health());

const transport = new StdioServerTransport();
await server.connect(transport);
