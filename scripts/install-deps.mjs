#!/usr/bin/env node
// Installs DD's packages into its own plugin directory, for hosts that copy the
// plugin without them (src/deps.js). Started detached by the first session or
// MCP server that finds them missing; one run at a time, through a lock file.
// Install scripts are skipped, as Claude Code does: the only one DD's packages
// carry downloads CUDA binaries, which DD does not use.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { INSTALL_FAILED, INSTALL_LOCK, INSTALL_LOG, LOCK_STALE_MS, missingDependencies } from '../src/deps.js';

const root = resolve(process.argv[2] ?? process.cwd());
const lock = join(root, INSTALL_LOCK);

function acquire() {
  try { closeSync(openSync(lock, 'wx')); return true; }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    try { if (Date.now() - statSync(lock).mtimeMs < LOCK_STALE_MS) return false; } catch { /* released meanwhile */ }
    rmSync(lock, { force: true });
    try { closeSync(openSync(lock, 'wx')); return true; } catch { return false; }
  }
}

if (!missingDependencies(root).length || !acquire()) process.exit(0);
rmSync(join(root, INSTALL_FAILED), { force: true });
const log = openSync(join(root, INSTALL_LOG), 'a');
const args = [existsSync(join(root, 'package-lock.json')) ? 'ci' : 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'];
// npm is a .cmd shim on Windows, which only a shell can start. The arguments are
// fixed; the directory is passed as cwd, never through the shell.
const code = await new Promise(done => {
  const child = spawn('npm', args, { cwd: root, stdio: ['ignore', log, log], windowsHide: true, shell: process.platform === 'win32' });
  child.on('error', err => { writeFileSync(join(root, INSTALL_FAILED), `npm could not be started: ${err.message}\n`); done(-1); });
  child.on('close', done);
});
closeSync(log);
if (code !== 0 && !existsSync(join(root, INSTALL_FAILED))) writeFileSync(join(root, INSTALL_FAILED), `npm ${args[0]} exited with code ${code}\n`);
rmSync(lock, { force: true });
// Start the resident now, so its model is loading before the next session asks.
if (code === 0) {
  const { ensureResident } = await import('../src/resident.js');
  await ensureResident(root).catch(() => {});
}
