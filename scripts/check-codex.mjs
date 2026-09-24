#!/usr/bin/env node
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callRunningStore } from '../src/hooks/bridge.js';

const i = process.argv.indexOf('--project');
if (i < 0 || !process.argv[i + 1]) throw new Error('Usage: node scripts/check-codex.mjs --project PROJECT');
const projectRoot = await realpath(resolve(process.argv[i + 1]));
// The project marker created by installation prevents ancestor-repo discovery
// from silently checking a different project (for example a nested fixture).
await access(join(projectRoot, '.codex/config.toml'));
await access(join(projectRoot, '.dd'));
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const transport = new StdioClientTransport({ command: process.execPath,
  args: [join(pluginRoot, 'src/mcp/server.js')], cwd: projectRoot, stderr: 'inherit',
  env: { ...process.env, DD_PROJECT_DIR: projectRoot, DD_DATA: join(projectRoot, '.dd/local') } });
const client = new Client({ name: 'dd-codex-install-check', version: '0.3.1' });
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    if (result.isError) throw new Error(`${name}: ${result.content[0].text}`);
    return JSON.parse(result.content[0].text);
  }
  const status = await call('status');
  const localConfig = JSON.parse(await readFile(join(projectRoot, '.dd/config.json'), 'utf8'));
  if (localConfig.project_id !== status.project_id) throw new Error('mcp_project_mismatch');
  const orientation = await call('orient', { budget_tokens: 600 });
  if (['admit', 'resolve', 'delete'].some(name => tools.some(t => t.name === name))) throw new Error('unsafe_mcp_surface');
  for (const name of ['orient', 'retrieve', 'get', 'propose', 'feedback', 'ui']) if (!tools.some(t => t.name === name)) throw new Error(`missing_tool:${name}`);
  // The shared resident opens a project the first time one of its hooks asks,
  // as a Codex session start will. Ask the same way, once it is listening.
  process.env.DD_DATA = join(projectRoot, '.dd/local');
  const deadline = Date.now() + 5000;
  while (!await callRunningStore('session-start', { session_id: 'dd-codex-check', cwd: projectRoot }, projectRoot)) {
    if (Date.now() > deadline) throw new Error('resident_unavailable: no resident of this DD build answered. See README > "Resident process".');
    await new Promise(done => setTimeout(done, 250));
  }
  // ui_url names the project (/?project=<key>) on the shared resident; keep that query.
  // Its UI key is what a browser trades for a cookie (src/ui/server.js); send it as one.
  const statusUrl = new URL(status.ui_url);
  statusUrl.pathname = '/api/status';
  const uiKey = statusUrl.searchParams.get('key');
  statusUrl.searchParams.delete('key');
  const audit = await fetch(statusUrl, { signal: AbortSignal.timeout(3000),
    headers: uiKey ? { cookie: `dd_ui_${statusUrl.port}=${uiKey}` } : {} });
  if (!audit.ok || (await audit.json()).project_id !== status.project_id) throw new Error('audit_project_mismatch');
  console.log(JSON.stringify({ connected: true, project_root: projectRoot, project_id: status.project_id,
    tools: tools.map(t => t.name), knowledge: status.counts, orientation, audit_http: 'passed',
    model_calls: 0, note: 'The diagnostic process closes after this check; Codex starts its own server when the project opens.' }, null, 2));
} finally { await client.close(); }
