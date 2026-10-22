#!/usr/bin/env node
import { findProjectRoot } from './engine/locate.cjs';
import { compileProject } from './engine/compile.js';
import { planCodexInstall, applyCodexInstall } from '../scripts/install-codex.mjs';
import { planOpencodeInstall, applyOpencodeInstall } from '../scripts/install-opencode.mjs';
import { VERSION } from './version.js';


const [command, ...rest] = process.argv.slice(2);

const USAGE = `DeltaDictum (DD) ${VERSION ?? ''}

Usage: deltadictum [command]

  init [--project-id NAME]
                      Opt this project in: write .dd/config.json, .dd/.gitignore and .dd/memories/, and compile
  install --host codex|opencode --project PATH [--dry-run]
                      Write DD's Codex or OpenCode configuration into a project
  import [--from DIR] [--dry-run]
                      Turn the project's .claude/rules/ and .cursor/rules/ files that name paths into memories
  compile             Compile this project's memories for delivery (.dd/local/compiled)
  recall QUERY [--all] [--limit N]
                      Print the memories that match QUERY in full (--all includes candidates)
  status              Memory counts by status, and topics with more than one live memory
  health              Each memory's health: dead triggers, idle, hubs, central paths, stale evidence, false alarms
  doctor              Is DD working here: Node, the opt-in, the index, sessions recorded, maintenance, what needs a person (exit 1 on a problem)
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
  // Claude Code and Grok Build install DD from their plugin marketplaces; Codex and OpenCode need their
  // project configuration written.
  const INSTALLS = {
    codex: { plan: planCodexInstall, apply: applyCodexInstall, next: 'Start a new Codex thread in this project. Review DD hooks in /hooks before enabling them.' },
    opencode: { plan: planOpencodeInstall, apply: applyOpencodeInstall, next: 'Start a new OpenCode session in this project; the dd-save, dd-recall and dd-review skills are available.' },
  };
  const install = INSTALLS[host];
  if (!install) {
    throw new Error(`install --host ${host ?? '<missing>'} is not supported. Use "codex" or "opencode"; Claude Code and Grok Build install DD from their plugin marketplaces (see Getting started).`);
  }
  if (!project) throw new Error(`Usage: deltadictum install --host ${host} --project PROJECT [--dry-run]`);
  const plan = await install.plan(project);
  if (!dryRun) await install.apply(plan);
  console.log(JSON.stringify({
    dry_run: dryRun, project: plan.projectRoot, data: plan.dataDir,
    files: plan.operations.map(op => op.path),
    next: install.next,
  }, null, 2));
}

// The project's opt-in (docs/DD.md): the folder, the config with the project id, the ignore file.
async function runInit(args) {
  const { initProject } = await import('./memory/init.js');
  const idAt = args.indexOf('--project-id');
  if (idAt >= 0 && !args[idAt + 1]) throw new Error('Usage: deltadictum init [--project-id NAME]');
  console.log(JSON.stringify(await initProject(findProjectRoot(process.cwd()), { projectId: idAt >= 0 ? args[idAt + 1] : null }), null, 2));
}

async function main() {
  if (['help', '--help', '-h'].includes(command)) { console.log(USAGE); return; }
  if (['version', '--version', '-v'].includes(command)) { console.log(VERSION ?? 'unknown'); return; }
  if (command === 'init') return runInit(rest);
  if (command === 'install') return runInstall(rest);
  if (command === 'import') {
    const { importRules } = await import('./memory/import.js');
    const fromAt = rest.indexOf('--from');
    if (fromAt >= 0 && !rest[fromAt + 1]) throw new Error('Usage: deltadictum import [--from DIR] [--dry-run]');
    console.log(JSON.stringify(await importRules(findProjectRoot(process.cwd()), { from: fromAt >= 0 ? rest[fromAt + 1] : null, dryRun: rest.includes('--dry-run') }), null, 2));
    return;
  }
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
  if (command === 'doctor') {
    const { doctorReport } = await import('./maintenance/doctor.js');
    const report = await doctorReport(findProjectRoot(process.cwd()));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
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
