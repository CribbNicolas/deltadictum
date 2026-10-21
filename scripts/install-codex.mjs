#!/usr/bin/env node
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const slash = path => path.replaceAll('\\', '/');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const psQuote = value => `'${String(value).replaceAll("'", "''")}'`;
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
  const hookPath = join(projectRoot, '.codex', 'hooks.json');
  const hookText = await optionalText(hookPath);
  const hooks = hookText ? JSON.parse(hookText) : { description: 'DeltaDictum: project memories at the actions they apply to, and capture.', hooks: {} };
  hooks.hooks ??= {};
  // The hooks Claude Code registers (hooks/hooks.json), with Codex's tool names:
  // every tool reaches pre-tool and observe, and proposals arrive through apply_patch.
  const HOOKS = [['SessionStart', 'session-start', ''], ['UserPromptSubmit', 'prompt', ''], ['UserPromptSubmit', 'observe-prompt', ''],
    ['PreToolUse', 'pre-tool', '*'], ['PostToolUse', 'observe', '*'], ['PostToolUse', 'inbox', 'apply_patch'], ['Stop', 'stop', '']];
  for (const [event, command, matcher] of HOOKS) {
    const args = [slash(process.execPath), slash(join(pluginRoot, 'hooks/run.cjs')), command, '--codex'];
    // A delivery is at most 10,000 characters (spec section 3); capture answers nothing but the inbox reply.
    const quiet = command === 'observe' || command === 'observe-prompt';
    const handler = { type: 'command', command: args.map(quote).join(' '),
      commandWindows: `& ${args.map(psQuote).join(' ')}`, timeout: command === 'session-start' || command === 'inbox' ? 30 : 10,
      ...(quiet ? { async: true } : ['pre-tool', 'prompt', 'inbox'].includes(command) ? { additionalContextLimit: 10000 } : {}) };
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
    if (!installed) groups.push({ ...(matcher ? { matcher } : {}), hooks: [handler] });
    hooks.hooks[event] = groups;
  }
  await plan(hookPath, `${JSON.stringify(hooks, null, 2)}\n`, hookText);
  // Codex has no plugin namespace, so the command skills are installed as dd-<name>:
  // a project's own review or init skill is never overwritten.
  // A skill file DD wrote (named dd-*) is DD's to replace on upgrade; any other
  // file at that path is the project's and stops the install for review.
  // Codex substitutes no ${CLAUDE_PLUGIN_ROOT}: the copies name the directory DD
  // runs from, as the hooks do.
  const skillName = text => /^---\r?\nname: (.+?)\r?$/m.exec(text ?? '')?.[1]?.trim();
  const ddOwned = text => /^dd-[a-z]+$/.test(skillName(text) ?? '');
  const skills = ['save', 'recall', 'review'];
  for (const skill of skills) {
    const content = (await readFile(join(pluginRoot, 'skills', skill, 'SKILL.md'), 'utf8'))
      .replace(/^(---\r?\nname: )(.+)$/m, `$1dd-${skill}`)
      .replaceAll('${CLAUDE_PLUGIN_ROOT}', slash(pluginRoot));
    const path = join(projectRoot, '.agents', 'skills', `dd-${skill}`, 'SKILL.md');
    const before = await optionalText(path);
    if (before && before !== content && !ddOwned(before)) throw new Error(`existing_skill_requires_review:${path}`);
    await plan(path, content, before);
  }
  const agentsPath = join(projectRoot, 'AGENTS.md');
  const agents = await optionalText(agentsPath);
  await plan(agentsPath, managedBlock(agents, agentsStart, agentsEnd, `## DD project knowledge

DD hooks add this project's memories before the actions they apply to. Treat them as advice: the current code, the project's documents and the user take precedence. When you learn something an agent reading the code would miss, save it with the dd-save skill.`), agents);
  const ignorePath = join(projectRoot, '.dd', '.gitignore');
  let ignore = await optionalText(ignorePath);
  for (const pattern of ['local/', 'memories/manifest.json', 'inbox/', '.write-lock', '.pending-write.json', '*.tmp', '*.sqlite', '*.sqlite-*']) {
    if (!ignore.split(/\r?\n/).includes(pattern)) ignore = `${ignore.trimEnd()}${ignore.trim() ? '\n' : ''}${pattern}\n`;
  }
  await plan(ignorePath, ignore);
  // The install is the project's opt-in (docs/DD.md): a .dd/config.json with the
  // project id, as `deltadictum init` writes it; one already there is the project's.
  const configJsonPath = join(projectRoot, '.dd', 'config.json');
  if (!(await optionalText(configJsonPath))) await plan(configJsonPath, `${JSON.stringify({ project_id: basename(projectRoot) }, null, 2)}\n`, '');
  return { projectRoot, pluginRoot, dataDir, operations };
}

export async function applyCodexInstall(plan) {
  // Preflight every destination before any changes, preserving unrelated config.
  for (const op of plan.operations) if (await optionalText(op.path) !== op.before) throw new Error(`destination_changed:${op.path}`);
  for (const op of plan.operations) {
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
