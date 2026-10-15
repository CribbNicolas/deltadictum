#!/usr/bin/env node
import { join } from 'node:path';
import { findProjectRoot } from './engine/locate.cjs';
import { migrateProject } from './memory/migrate.js';
import { compileProject } from './engine/compile.js';
import { planCodexInstall, applyCodexInstall } from '../scripts/install-codex.mjs';
import { VERSION } from './version.js';


const [command, ...rest] = process.argv.slice(2);

const USAGE = `DeltaDictum (DD) ${VERSION ?? ''}

Usage: deltadictum [command]

  init [--project-id NAME]
                      Opt this project in: write .dd/config.json, .dd/.gitignore and .dd/memories/, and compile
  install --host codex --project PATH [--dry-run]
                      Write DD's Codex configuration into a project
  migrate [--dry-run] Convert this project's v1 knowledge (.dd/atoms and the rest) to v2 memories
  compile             Compile this project's memories for delivery (.dd/local/v2)
  recall QUERY [--all] [--limit N]
                      Print the memories that match QUERY in full (--all includes candidates)
  status              Memory counts by status, and topics with more than one live memory
  health              Each memory's health: dead triggers, idle, hubs, central paths, stale evidence, false alarms
  maintain            Roll session files up into local telemetry, prune them, retire unused memories (runs daily on its own)
  ui [--port N]       The review UI for this project, until interrupted (default port 7733)
  help                Show this help
  version             Print the version`;

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

// The project's opt-in (docs/DD.md): the folder, the config with the project id, the ignore file.
async function runInit(args) {
  const { initProject } = await import('./memory/init.js');
  const idAt = args.indexOf('--project-id');
  if (idAt >= 0 && !args[idAt + 1]) throw new Error('Usage: deltadictum init [--project-id NAME]');
  console.log(JSON.stringify(await initProject(findProjectRoot(process.cwd()), { projectId: idAt >= 0 ? args[idAt + 1] : null }), null, 2));
}

// Converts the project's v1 store before any store opens it: a v2 store has no atoms to index.
async function runMigrate(args) {
  const repoRoot = findProjectRoot(process.cwd());
  const report = await migrateProject({ ddDir: join(repoRoot, '.dd'), dryRun: args.includes('--dry-run') });
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length || report.unreadable.length) process.exitCode = 1;
}

async function main() {
  if (['help', '--help', '-h'].includes(command)) { console.log(USAGE); return; }
  if (['version', '--version', '-v'].includes(command)) { console.log(VERSION ?? 'unknown'); return; }
  if (command === 'init') return runInit(rest);
  if (command === 'install') return runInstall(rest);
  if (command === 'migrate') return runMigrate(rest);
  if (command === 'recall') {
    const { recall } = await import('./maintenance/recall.js');
    const limitAt = rest.indexOf('--limit');
    const limit = limitAt >= 0 ? Number(rest[limitAt + 1]) || 5 : 5;
    const query = rest.filter((arg, i) => arg !== '--all' && (limitAt < 0 || (i !== limitAt && i !== limitAt + 1))).join(' ');
    console.log(await recall(findProjectRoot(process.cwd()), query, { all: rest.includes('--all'), limit }));
    return;
  }
  if (command === 'status') {
    const { status } = await import('./maintenance/recall.js');
    console.log(JSON.stringify(await status(findProjectRoot(process.cwd())), null, 2));
    return;
  }
  if (command === 'health') {
    const { healthReport } = await import('./maintenance/health.js');
    console.log(JSON.stringify(await healthReport(findProjectRoot(process.cwd())), null, 2));
    return;
  }
  if (command === 'maintain') {
    const { maintain } = await import('./maintenance/maintain.js');
    console.log(JSON.stringify(await maintain(findProjectRoot(process.cwd())), null, 2));
    return;
  }
  if (command === 'compile') {
    console.log(JSON.stringify(await compileProject(findProjectRoot(process.cwd())), null, 2));
    return;
  }
  if (!command) { console.log(USAGE); return; }
  if (command === 'ui') return runUi(rest);
  console.error(`Unknown command: ${command}\n\n${USAGE}`);
  process.exitCode = 1;
}

// The review UI for the project in the current folder, until interrupted. A busy
// port falls back to a free one: the printed address is the one that answers.
async function runUi(args) {
  const { startReviewServer } = await import('./ui/server.js');
  const root = findProjectRoot(process.cwd());
  const portAt = args.indexOf('--port');
  const port = portAt >= 0 ? Number(args[portAt + 1]) || 0 : 7733;
  const server = await startReviewServer({ root, port }).catch(err => {
    if (err.code === 'EADDRINUSE') return startReviewServer({ root, port: 0 });
    throw err;
  });
  console.log(`DD - review UI: ${server.url}`);
  const stop = async () => { await server.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
