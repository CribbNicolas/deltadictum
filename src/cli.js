#!/usr/bin/env node
import { openStore } from './project.js';
import { startUiServer } from './ui/server.js';
import { orientProject } from './engine/project-context.js';
import { writeUiUrl, recordedUiUrl } from './hooks/banner.js';
import { residentStatus, retireResident } from './resident.js';
import { BUILD_ID } from './hooks/build.js';
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
  const { store, projectId, ddDir, dataDir, repoRoot } = await openStore();
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
  await runResident({ store, projectId, ddDir, repoRoot });
}

// The resident process (L2): one per project, shared by every session. It steps
// aside for a live one of the same build, replaces one from another build, and
// exits after a long idle period so a forgotten project does not keep it alive.
const IDLE_EXIT_MS = 12 * 60 * 60 * 1000;
async function runResident({ store, projectId, ddDir, repoRoot }) {
  const existing = await residentStatus(repoRoot);
  if (existing?.build === BUILD_ID && !existing.stale) {
    console.log(`DD - UI ${existing.url} (already running)`);
    store.close();
    return;
  }
  if (existing) await retireResident(existing);
  let ui;
  const stop = async () => { await ui?.close(); store.close(); process.exit(0); };
  ui = await startUiServer({ store, projectId, semantic: true, onShutdown: stop });
  await writeUiUrl(ddDir, ui);
  console.log(`DD - UI ${ui.url}`);
  // Two sessions can start a resident at the same moment; the one whose URL did
  // not stay in ui.json leaves.
  setTimeout(async () => { if (await recordedUiUrl(ddDir) !== ui.url) await stop(); }, 500).unref();
  setInterval(() => { if (ui.idleFor() > IDLE_EXIT_MS) void stop(); }, 60 * 1000).unref();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
