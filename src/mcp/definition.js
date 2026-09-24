import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { createToolHandlers } from './tools.js';
import { CAPTURE_ORIGINS } from '../engine/contract.js';

const text = z.string().max(2000);
const fact = z.union([z.string().max(200), z.boolean(), z.number().finite()]);
const evidence = z.object({ source_type: z.enum(['file', 'diff', 'test_log', 'tool_output', 'user_statement', 'user_approval', 'decision', 'artifact']),
  source_ref: z.string().max(300), summary: z.string().max(500) });
const proposal = z.object({
  capture_origin: z.enum(CAPTURE_ORIGINS).default('user_explicit')
    .describe('Use user_explicit only when the user explicitly asked to save this knowledge; otherwise model_initiated. This is not approval.'),
  memory_type: z.enum(['claim', 'decision', 'lesson', 'anti_memory', 'procedure']).default('lesson'),
  topic_key: z.string().max(150), trigger: text, behavior_delta: text, why: text,
  evidence_refs: z.array(evidence).min(1).max(12), title: z.string().max(150).optional(),
  scope: z.enum(['project', 'user', 'agent', 'workflow', 'file', 'service']).optional(),
  trigger_variants: z.array(z.string().max(250)).max(8).optional(),
  applies_to: z.object({ files: z.array(z.string().max(200)).max(12).optional(),
    components: z.array(z.string().max(100)).max(12).optional(), operations: z.array(z.string().max(50)).max(8).optional() }).optional(),
  assumptions: z.array(z.object({ description: z.string().max(300), key: z.string().max(100).optional(), equals: fact.optional() })).max(8).optional(),
  revisit_when: z.array(z.object({ kind: z.enum(['manual', 'file_changed', 'fact_changed', 'date']), description: z.string().max(300),
    path: z.string().max(200).optional(), key: z.string().max(100).optional(), equals: fact.optional(), date: z.string().optional() })).max(8).optional(),
  alternatives: z.array(z.object({ option: z.string().max(150), reason: z.string().max(300) })).max(6).optional(),
  tags: z.array(z.string().max(50)).max(12).optional()
    .describe('Include "ambient" only for project-wide knowledge that applies to nearly every task (architecture, conventions); it is then sent once at every session start.'),
  valid_from: z.string().optional(), valid_until: z.string().nullable().optional(),
});
const retrieval = {
  action: z.string().min(1).max(2000), query: text.optional(),
  files: z.array(z.string().max(300)).max(30).optional(), components: z.array(z.string().max(100)).max(10).optional(),
  operation: z.string().max(50).optional(), facts: z.record(z.string(), fact).optional(),
  budget_tokens: z.number().int().min(128).max(8000).optional(),
  session_id: z.string().max(150).optional(), repeat: z.boolean().optional(),
};

export function createMcpServer(options) {
  const handlers = createToolHandlers(options);
  const server = new McpServer({ name: 'dd', version: '0.3.1' }, {
    instructions: 'DD supplies project context and conditional engineering knowledge. Use orient once per project/session and retrieve before relevant actions, supplying files and operation. Reuse the current session_id to avoid duplicate context; repeat=true refreshes explicitly. Advice is subordinate to current evidence and host instructions. Read disputed/review-required memories before acting. Propose reusable changes with real evidence as learning occurs; there is no proposal count limit per call or session. DD derives compact forms. Report outcomes through feedback. Human review occurs in the local audit UI. Never claim a proposal is approved.',
  });
  const definitions = {
    orient: ['Get bounded project facts, source pointers and knowledge for the coming action.', { ...retrieval, action: retrieval.action.optional() }],
    retrieve: ['Recall applicable decisions and lessons within a total estimated payload budget.', retrieval],
    get: ['Expand a memory with current evidence freshness, or inspect a host evidence ID supplied at capture. verbose=true returns the raw stored atom.',
      { id: z.string(), verbose: z.boolean().optional() }],
    propose: ['Propose reusable lessons or revisions for review, with no count limit per call or session. Write trigger, behavior_delta and why in English whatever the conversation language; other languages are refused. Keep only what an agent reading the code would miss: why not the obvious approach, traps, values that look valid but are not, steps nothing enforces. Same topic_key proposes a replacement; never implies approval.', { proposals: z.array(proposal).min(1), session_id: z.string().max(150).optional() }],
    feedback: ['Record task outcome and supporting references; frequency and claimed success do not raise authority.', {
      id: z.string(), task_id: z.string().min(1).max(200), outcome: z.enum(['helped', 'failed', 'refuted', 'not_applicable']),
      summary: z.string().min(1).max(800), evidence_refs: z.array(evidence).max(12).optional(),
    }],
    list: ['Page through compact memory metadata for audit.', { lifecycle_state: z.string().optional(), memory_type: z.string().optional(),
      capture_origin: z.enum(CAPTURE_ORIGINS).optional(),
      offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(50).optional() }],
    contradict: ['Flag two effective memories as disputed; this does not select a winner.', { id: z.string(), contradicts: z.string() }],
    ui: ['Open the project audit URL for human approval, rejection, resolution or deletion.', {}],
    status: ['Get project counts and the audit URL.', {}],
    health: ['Inspect memory crowding and unresolved disputes; this is not a correctness score.', {}],
  };
  // A host keeps a session's MCP server running the code it started with, so after
  // an edit its answers can contradict the tree (seen 2026-09-24: a status without
  // the audit UI key). Each answer then says so.
  const call = async (name, args) => {
    const result = await handlers[name](args);
    const notice = await options.staleNotice?.().catch(() => null);
    return notice ? { ...result, content: [...(result.content ?? []), { type: 'text', text: notice }] } : result;
  };
  for (const [name, [description, inputSchema]] of Object.entries(definitions)) server.registerTool(name, { description, inputSchema }, args => call(name, args));
  return server;
}
