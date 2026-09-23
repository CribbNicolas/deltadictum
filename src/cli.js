#!/usr/bin/env node
import { openStore } from './project.js';
import { startResidentServer } from './ui/server.js';
import { orientProject } from './engine/project-context.js';
import { readRegistry, residentStatus, retireResident, writeRegistry } from './resident.js';
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
  if (!project) throw new Error('Usage: deltadictum install --host codex --project PROJECT [--dry-run]');
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
  if (!command || command === 'ui' || command === 'resident') return runResident();
  const { store, projectId } = await openStore();
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
  store.close();
  throw new Error(`Unknown command: ${command}`);
}

// The resident process (L2): one per machine, shared by every project and
// session. It opens each project's store the first time a hook or the audit UI
// asks for it, and loads the embedding model once. It steps aside for a live
// one of the same build, replaces one from another build, and exits after a
// long idle period.
const IDLE_EXIT_MS = 12 * 60 * 60 * 1000;
async function runResident() {
  const existing = await residentStatus();
  if (existing?.build === BUILD_ID && !existing.stale) {
    console.log(`DD - resident ${existing.url} (already running)`);
    return;
  }
  if (existing) await retireResident(existing);
  let server;
  const stop = async () => { await server?.close(); process.exit(0); };
  const openProject = async (repoRoot, dataDir) => {
    const { store, projectId } = await openStore({ cwd: repoRoot, dataDir });
    return { store, projectId };
  };
  server = await startResidentServer({ openProject, semantic: true, onShutdown: stop });
  await writeRegistry(server);
  console.log(`DD - resident ${server.url}`);
  // Two sessions can start a resident at the same moment; the one whose URL did
  // not stay in the registry leaves.
  setTimeout(async () => { if ((await readRegistry())?.url !== server.url) await stop(); }, 500).unref();
  setInterval(() => { if (server.idleFor() > IDLE_EXIT_MS) void stop(); }, 60 * 1000).unref();
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
