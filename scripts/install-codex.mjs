#!/usr/bin/env node
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const slash = path => path.replaceAll('\\', '/');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
const configStart = '# BEGIN DD MANAGED CONFIG';
const configEnd = '# END DD MANAGED CONFIG';
const agentsStart = '<!-- BEGIN DD PROJECT KNOWLEDGE -->';
const agentsEnd = '<!-- END DD PROJECT KNOWLEDGE -->';

async function optionalText(path) {
  try { return await readFile(path, 'utf8'); } catch (err) { if (err.code === 'ENOENT') return ''; throw err; }
}
function managedBlock(text, start, end, content) {
  const from = text.indexOf(start), until = text.indexOf(end);
  if (from < 0 && until < 0) return `${text.trimEnd()}${text.trim() ? '\n\n' : ''}${start}\n${content}\n${end}\n`;
  if (from < 0 || until < from || text.indexOf(start, from + start.length) >= 0) throw new Error('invalid_managed_block');
  return text.slice(0, from) + `${start}\n${content}\n${end}` + text.slice(until + end.length);
}

// npx runs a package from a cache npm may clear at any time. The config written
// here names this directory for every later session, so it must be one that
// stays: a global install or a source checkout.
export function ephemeralRoot(root) {
  return /\/_npx\//.test(slash(root));
}

export async function planCodexInstall(project, { root = pluginRoot } = {}) {
  if (ephemeralRoot(root)) throw new Error(`ephemeral_install: DD is running from the npx cache (${slash(root)}), which npm may clear, and Codex would keep pointing at it. Install it globally, then run the installer from there: npm install -g deltadictum && deltadictum install --host codex --project PROJECT`);
  const projectRoot = await realpath(resolve(project));
  const dataDir = join(projectRoot, '.dd', 'local');
  const operations = [];
  async function plan(path, content, before = undefined) {
    before ??= await optionalText(path);
    if (before !== content) operations.push({ path, before, content });
  }
  const configPath = join(projectRoot, '.codex', 'config.toml');
  const config = await optionalText(configPath);
  if (!config.includes(configStart) && /^\s*\[mcp_servers\.(?:dd|"dd"|'dd')(?:\]|\.)/m.test(config)) throw new Error('existing_dd_server_requires_review');
  // v2 runs no MCP server: the managed block that registered it is emptied, and
  // per-tool preferences for that server go with it (plan 7 rewrites this installer).
  const configBody = '# DD v2 delivers through hooks and runs no MCP server.';
  await plan(configPath, managedBlock(config, configStart, configEnd, configBody), config);

  const hookPath = join(projectRoot, '.codex', 'hooks.json');
  const hookText = await optionalText(hookPath);
  const hooks = hookText ? JSON.parse(hookText) : { description: 'DeltaDictum project orientation, conditional recall and selective capture.', hooks: {} };
  hooks.hooks ??= {};
  for (const [event, command] of [['SessionStart', 'session-start'], ['PreToolUse', 'pre-tool'], ['UserPromptSubmit', 'prompt'], ['PostToolUse', 'observe'], ['Stop', 'stop']]) {
    const args = [slash(process.execPath), slash(join(pluginRoot, 'hooks/run.cjs')), command, '--codex', '--data', slash(dataDir)];
    const handler = { type: 'command', command: args.map(quote).join(' '),
      commandWindows: `& ${args.map(psQuote).join(' ')}`, timeout: 10,
      // SessionStart carries the memory map (up to MAP_BUDGET = 5000 tokens, grouped past it), so its limit is wider.
      ...(event === 'PostToolUse' ? { async: true } : event === 'Stop' ? {} : { additionalContextLimit: event === 'SessionStart' ? 24000 : 800 }) };
    // A handler DD wrote is recognised by its runner and event, not by its full command:
    // a new Node path or DD directory (a source checkout moved to a global install) would
    // otherwise leave the old handler beside the new one and run DD twice per event.
    const owned = previous => typeof previous?.command === 'string'
      && [`src/hooks/run.js' '${command}' '--codex'`, `hooks/run.cjs' '${command}' '--codex'`].some(owned => slash(previous.command).includes(owned));
    let installed = false;
    const groups = (hooks.hooks[event] ?? []).filter(group => {
      if (!Array.isArray(group?.hooks) || !group.hooks.some(owned)) return true;
      // Upgrades refresh limits/timeouts as well as commands; a second DD copy is dropped,
      // other handlers and the group's matcher are kept.
      group.hooks = group.hooks.flatMap(previous => !owned(previous) ? [previous] : installed ? [] : (installed = true, [handler]));
      return group.hooks.length > 0;
    });
    if (!installed) groups.push({ ...(event === 'PreToolUse' || event === 'PostToolUse' ? { matcher: '*' } : {}), hooks: [handler] });
    hooks.hooks[event] = groups;
  }
  await plan(hookPath, `${JSON.stringify(hooks, null, 2)}\n`, hookText);
  // Codex has no plugin namespace, so the command skills are installed as dd-<name>:
  // a project's own review or init skill is never overwritten.
  // A skill file DD wrote (named dd or dd-*) is DD's to replace on upgrade; any
  // other file at that path is the project's and stops the install for review.
  const skillName = text => /^---\r?\nname: (.+?)\r?$/m.exec(text ?? '')?.[1]?.trim();
  const ddOwned = text => /^dd(-[a-z]+)?$/.test(skillName(text) ?? '');
  const skills = ['save', 'recall', 'review'];
  for (const skill of skills) {
    const content = (await readFile(join(pluginRoot, 'skills', skill, 'SKILL.md'), 'utf8'))
      .replace(/^(---\r?\nname: )(.+)$/m, `$1dd-${skill}`);
    const path = join(projectRoot, '.agents', 'skills', `dd-${skill}`, 'SKILL.md');
    const before = await optionalText(path);
    if (before && before !== content && !ddOwned(before)) throw new Error(`existing_skill_requires_review:${path}`);
    await plan(path, content, before);
  }
  // 0.3.x installed the recall skill as `dd`, and v1 shipped five skills v2 does
  // not; DD's own copies are retired, not left beside the current ones.
  for (const name of ['dd', 'dd-audit', 'dd-clean', 'dd-compact', 'dd-prospect', 'dd-init']) {
    const retired = join(projectRoot, '.agents', 'skills', name, 'SKILL.md');
    const retiredText = await optionalText(retired);
    if (retiredText && skillName(retiredText) === name) await plan(retired, null, retiredText);
  }
  const agentsPath = join(projectRoot, 'AGENTS.md');
  const agents = await optionalText(agentsPath);
  await plan(agentsPath, managedBlock(agents, agentsStart, agentsEnd, `## DD project knowledge

Use the local DD MCP server and the dd-recall skill when working in this project. Call orient at the start of a task and retrieve before relevant implementation or debugging, supplying affected files and operation. Reuse the session_id supplied by the DD session hook; otherwise generate one per conversation. After compaction, refresh with repeat: true.

Treat retrieved knowledge as conditional advice. Inspect evidence for disputed or review-required decisions; current code, project documentation and user instructions take precedence. Read source pointers as needed instead of loading the whole memory store.

At meaningful checkpoints, propose supported reusable decisions or lessons with actual repository evidence. There is no proposal count limit per call or session. Set capture_origin to model_initiated for autonomous discoveries or user_explicit for requested saves. Report proposals as pending review. Use feedback for observed outcomes and ui for human review. Do not self-approve memories or read chat transcripts to build them. If DD is unavailable, continue the task and report that project memory was unavailable.`), agents);
  const ignorePath = join(projectRoot, '.dd', '.gitignore');
  let ignore = await optionalText(ignorePath);
  for (const pattern of ['local/', '.write-lock', '.pending-write.json', '*.tmp', '*.sqlite', '*.sqlite-*']) {
    if (!ignore.split(/\r?\n/).includes(pattern)) ignore = `${ignore.trimEnd()}${ignore.trim() ? '\n' : ''}${pattern}\n`;
  }
  await plan(ignorePath, ignore);
  return { projectRoot, pluginRoot, dataDir, operations };
}

export async function applyCodexInstall(plan) {
  // Preflight every destination before any changes, preserving unrelated config.
  for (const op of plan.operations) if (await optionalText(op.path) !== op.before) throw new Error(`destination_changed:${op.path}`);
  for (const op of plan.operations) {
    // null content retires a file DD wrote earlier.
    if (op.content === null) { await rm(op.path, { force: true }); continue; }
    await mkdir(dirname(op.path), { recursive: true });
    await writeFile(op.path, op.content, 'utf8');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--project');
  if (i < 0 || !process.argv[i + 1]) throw new Error('Usage: node scripts/install-codex.mjs --project PROJECT [--dry-run]');
  const plan = await planCodexInstall(process.argv[i + 1]);
  const dryRun = process.argv.includes('--dry-run');
  if (!dryRun) await applyCodexInstall(plan);
  console.log(JSON.stringify({ dry_run: dryRun, project: plan.projectRoot, data: plan.dataDir,
    files: plan.operations.map(op => op.path), next: 'Start a new Codex thread in this project. Review DD hooks in /hooks before enabling them.' }, null, 2));
}
