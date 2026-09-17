#!/usr/bin/env node
import { access, readFile, realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

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
const client = new Client({ name: 'dd-codex-install-check', version: '0.2.0' });
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
  const audit = await fetch(`${status.ui_url}/api/status`, { signal: AbortSignal.timeout(3000) });
  if (!audit.ok || (await audit.json()).project_id !== status.project_id) throw new Error('audit_project_mismatch');
  console.log(JSON.stringify({ connected: true, project_root: projectRoot, project_id: status.project_id,
    tools: tools.map(t => t.name), knowledge: status.counts, orientation, audit_http: 'passed',
    model_calls: 0, note: 'The diagnostic process closes after this check; Codex starts its own server when the project opens.' }, null, 2));
} finally { await client.close(); }
