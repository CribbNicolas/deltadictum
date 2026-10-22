#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCodexInstall, ephemeralRoot, optionalText, planShared } from './install-codex.mjs';

// Cursor (preview): project hooks in .cursor/hooks.json, which Cursor runs in a trusted workspace, through
// PowerShell on Windows. Skills go to .agents/skills, one of the folders Cursor discovers them in (its CLI's
// source, 2026.10.19), and the advice to AGENTS.md, which Cursor reads.
const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const slash = path => path.replaceAll('\\', '/');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
// Anchored: Cursor tests a matcher as a regular expression against the tool's name, and ReadLints contains Read.
const TOOLS = '^(?:Read|Write|Shell|Grep|Delete|List)$';
// [event, DD command, matcher, timeout in seconds]. Where an event runs two, capture comes first: Cursor keeps
// the last hook's additional_context when two set it.
const HOOKS = [
  ['sessionStart', 'session-start', '', 30],
  ['beforeSubmitPrompt', 'observe-prompt', '', 10],
  ['beforeSubmitPrompt', 'prompt', '', 10],
  ['preToolUse', 'pre-tool', TOOLS, 10],
  ['postToolUse', 'observe', TOOLS, 10],
  ['postToolUse', 'inbox', '^Write$', 30],
  ['postToolUseFailure', 'observe', TOOLS, 10],
  ['stop', 'stop', '', 10],
];

export function cursorCommand(command, { node = process.execPath, root = pluginRoot, platform = process.platform } = {}) {
  const args = [slash(node), slash(join(root, 'hooks/run.cjs')), command, '--cursor'];
  return platform === 'win32' ? `& ${args.map(psQuote).join(' ')}` : args.map(quote).join(' ');
}

export async function planCursorInstall(project, { root = pluginRoot, platform = process.platform } = {}) {
  if (ephemeralRoot(root)) throw new Error(`ephemeral_install: DD is running from the npx cache (${slash(root)}), which npm may clear, and Cursor would keep pointing at it. Install it globally, then run the installer from there: npm install -g deltadictum && deltadictum install --host cursor --project PROJECT`);
  const projectRoot = await realpath(resolve(project));
  const dataDir = join(projectRoot, '.dd', 'local');
  const operations = [];
  async function plan(path, content, before = undefined) {
    before ??= await optionalText(path);
    if (before !== content) operations.push({ path, before, content });
  }
  const hookPath = join(projectRoot, '.cursor', 'hooks.json');
  const hookText = await optionalText(hookPath);
  const config = hookText ? JSON.parse(hookText) : { version: 1, hooks: {} };
  config.version ??= 1;
  config.hooks ??= {};
  // DD's own entries are the ones that run its hook with --cursor; every other hook is kept as it is.
  const owned = (entry, command) => typeof entry?.command === 'string' && slash(entry.command).includes(`hooks/run.cjs' '${command}' '--cursor'`);
  for (const [event, command, matcher, timeout] of HOOKS) {
    const entry = { command: cursorCommand(command, { root, platform }), timeout, ...(matcher ? { matcher } : {}) };
    const entries = config.hooks[event] ?? [];
    const at = entries.findIndex(previous => owned(previous, command));
    config.hooks[event] = at >= 0 ? entries.map((previous, i) => (i === at ? entry : previous)).filter((previous, i) => i === at || !owned(previous, command)) : [...entries, entry];
  }
  await plan(hookPath, `${JSON.stringify(config, null, 2)}\n`, hookText);
  await planShared({ projectRoot, root, plan, skillsDir: join(projectRoot, '.agents', 'skills'), saveWith: 'the dd-save skill' });
  return { projectRoot, pluginRoot: root, dataDir, operations };
}

export const applyCursorInstall = applyCodexInstall;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--project');
  if (i < 0 || !process.argv[i + 1]) throw new Error('Usage: node scripts/install-cursor.mjs --project PROJECT [--dry-run]');
  const plan = await planCursorInstall(process.argv[i + 1]);
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) await applyCursorInstall(plan);
  console.log(JSON.stringify({ dry_run: dryRun, project: plan.projectRoot, data: plan.dataDir,
    files: plan.operations.map(op => op.path), next: 'Open the project in Cursor and trust the workspace; DD\'s hooks show in Cursor Settings → Hooks.' }, null, 2));
}
