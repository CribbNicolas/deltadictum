#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openStore } from '../project.js';
import { DEFAULT_UI_URL } from '../hooks/banner.js';
import { ensureResident, projectUiUrl } from '../resident.js';
import { createMcpServer } from './definition.js';
import { codeFingerprint } from '../hooks/build.js';

const { store, projectId, repoRoot } = await openStore();
// The audit UI is the machine's resident process, shared by every project and
// session, not a part of this one: a session's MCP server exits with it (L2).
await ensureResident(repoRoot).catch(() => null);
const startedCode = await codeFingerprint().catch(() => null);
let codeChecked = { at: 0, stale: false };
async function staleNotice() {
  if (!startedCode) return null;
  if (!codeChecked.stale && Date.now() - codeChecked.at > 5000) codeChecked = { at: Date.now(), stale: await codeFingerprint() !== startedCode };
  return codeChecked.stale ? 'DD - This MCP server runs DD code older than its source tree, which changed after it started. Tell the user to reconnect it (in Claude Code: /mcp).' : null;
}
const server = createMcpServer({ store, projectId, repoRoot, staleNotice,
  uiUrl: async () => (await projectUiUrl(repoRoot)) ?? DEFAULT_UI_URL });
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
