#!/usr/bin/env node
import { openStore } from './project.js';
import { startUiServer } from './ui/server.js';
import { orientProject } from './engine/project-context.js';
import { writeUiUrl } from './hooks/banner.js';
import { planCodexInstall, applyCodexInstall } from '../scripts/install-codex.mjs';

const [command, ...rest] = process.argv.slice(2);

async function runInstall(args) {
  const hostIdx = args.indexOf('--host');
  const host = hostIdx >= 0 ? args[hostIdx + 1] : undefined;
  const projectIdx = args.indexOf('--project');
  const project = projectIdx >= 0 ? args[projectIdx + 1] : undefined;
  const dryRun = args.includes('--dry-run');
  if (host !== 'codex') {
    throw new Error(`install --host ${host ?? '<missing>'} is not supported. Only "codex" needs a scripted installer — Claude Code, Grok Build and OpenCode install through their own marketplace/npm mechanisms (see README).`);
  }
  if (!project) throw new Error('Usage: dd install --host codex --project PROJECT [--dry-run]');
  const plan = await planCodexInstall(project);
  if (!dryRun) await applyCodexInstall(plan);
  console.log(JSON.stringify({
    dry_run: dryRun, project: plan.projectRoot, data: plan.dataDir,
    files: plan.operations.map(op => op.path),
    next: 'Start a new Codex thread in this project. Review DD hooks in /hooks before enabling them.',
  }, null, 2));
}

async function main() {
  if (command === 'install') return runInstall(rest);
  if (command === 'mcp') { await import('./mcp/server.js'); return; }
  const { store, projectId, ddDir, dataDir } = await openStore();
  if (command === 'orient') {
    console.log(JSON.stringify(await orientProject({ action: rest.join(' ') || undefined }, { store, projectId })));
    store.close(); return;
  }
  if (command === 'maintain') {
    await store.prune();
    console.log('Local observations and telemetry pruned to configured retention limits.');
    store.close(); return;
  }
  if (command === 'reindex') {
    const result = await store.reindex();
    console.log(`reindexed ${result.atoms} atoms`);
    store.close();
    return;
  }
  if (command === 'status') {
    const { counts, total } = await store.countByLifecycle(projectId);
    console.log(JSON.stringify({
      project_id: projectId,
      ddDir,
      dataDir,
      total,
      by_state: counts,
    }, null, 2));
    store.close();
    return;
  }
  if (command === 'health') {
    const report = await store.assessDeterioration(projectId);
    console.log(JSON.stringify(report, null, 2));
    store.close();
    return;
  }
  const ui = await startUiServer({ store, projectId });
  await writeUiUrl(ddDir, ui);
  console.log(`DD - UI ${ui.url}`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
