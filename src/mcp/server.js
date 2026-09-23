#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openStore } from '../project.js';
import { readUiUrl } from '../hooks/banner.js';
import { ensureResident } from '../resident.js';
import { createMcpServer } from './definition.js';

const { store, projectId, ddDir, repoRoot } = await openStore();
// The audit UI is the resident process, shared by every session, not a part of
// this one: a session's MCP server exits with the session (L2).
await ensureResident(repoRoot).catch(() => null);
const server = createMcpServer({ store, projectId, repoRoot, uiUrl: () => readUiUrl(ddDir) });
const transport = new StdioServerTransport();
await server.connect(transport);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  store.close();
}
const previousClose = transport.onclose;
transport.onclose = () => { previousClose?.(); void close(); };
process.once('SIGINT', async () => { await close(); process.exit(0); });
process.once('SIGTERM', async () => { await close(); process.exit(0); });
