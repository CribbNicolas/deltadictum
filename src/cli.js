#!/usr/bin/env node
import { openStore } from './project.js';
import { startResidentServer } from './ui/server.js';
import { orientProject } from './engine/project-context.js';
import { readRegistry, residentFit, residentStatus, retireResident, writeRegistry } from './resident.js';
import { planCodexInstall, applyCodexInstall } from '../scripts/install-codex.mjs';
import { VERSION } from './hooks/build.js';

const [command, ...rest] = process.argv.slice(2);

const USAGE = `DeltaDictum (DD) ${VERSION ?? ''}

Usage: deltadictum [command]

  resident            Start the machine's resident process and audit UI (the default; alias: ui)
  mcp                 Run the MCP server over stdio for the project in DD_PROJECT_DIR or the current directory
  install --host codex --project PATH [--dry-run]
                      Write DD's Codex configuration into a project
  status              Knowledge counts by lifecycle state, and where the project's files live
  health              The deterioration report (crowding, disputes, unreadable knowledge files)
  orient [ACTION]     Project facts and source pointers, with knowledge for ACTION when given
  maintain            Prune local observations and telemetry to their retention limits
  reindex             Rebuild the local SQLite index from the project's .dd/ files
  help                Show this help
  version             Print the version`;

// Commands that open the project's store in the current directory. Anything
// else is refused before a store is opened, so a typo creates no .dd/ there.
const PROJECT_COMMANDS = ['orient', 'maintain', 'reindex', 'status', 'health'];

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
  if (['help', '--help', '-h'].includes(command)) { console.log(USAGE); return; }
  if (['version', '--version', '-v'].includes(command)) { console.log(VERSION ?? 'unknown'); return; }
  if (command === 'install') return runInstall(rest);
  if (command === 'mcp') { await import('./mcp/server.js'); return; }
  if (!command || command === 'ui' || command === 'resident') return runResident();
  if (!PROJECT_COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}\n\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
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
      dd_dir: ddDir,
      data_dir: dataDir,
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
// one serving this install or a newer version, replaces a stale or older one,
// and exits after a long idle period.
const IDLE_EXIT_MS = 12 * 60 * 60 * 1000;
async function runResident() {
  const existing = await residentStatus();
  const fit = residentFit(existing);
  if (fit === 'live' || fit === 'superseded') {
    console.log(`DD - resident ${existing.url} (already running${fit === 'superseded' ? `, version ${existing.version}, newer than this install` : ''})`);
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
