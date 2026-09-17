#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openStore } from '../project.js';
import { startUiServer } from '../ui/server.js';
import { writeUiUrl } from '../hooks/banner.js';
import { createMcpServer } from './definition.js';

const { store, projectId, ddDir } = await openStore();
let ui;
try {
  ui = await startUiServer({ store, projectId });
  await writeUiUrl(ddDir, ui);
} catch (err) { process.stderr.write(`DD audit UI unavailable: ${err.message}\n`); }
const server = createMcpServer({ store, projectId, uiPort: ui?.port ?? 7733 });
const transport = new StdioServerTransport();
await server.connect(transport);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  if (ui) await ui.close();
  store.close();
}
const previousClose = transport.onclose;
transport.onclose = () => { previousClose?.(); void close(); };
process.once('SIGINT', async () => { await close(); process.exit(0); });
process.once('SIGTERM', async () => { await close(); process.exit(0); });
