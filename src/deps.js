import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Some hosts copy a plugin without installing its packages: Grok Build states
// that plugins deliver files, not runtimes. Claude Code runs `npm ci
// --ignore-scripts` itself; npm and a source checkout already have them. Without
// the three required packages (L3) the MCP server cannot start and the resident
// cannot load its model, so the first session to find them missing installs
// them into the plugin directory, in the background (L5), and DD stays inactive
// until they are there.
export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const INSTALL_LOCK = '.dd-install.lock';
export const INSTALL_FAILED = '.dd-install.failed';
export const INSTALL_LOG = '.dd-install.log';
// An install that has held the lock this long is presumed dead.
export const LOCK_STALE_MS = 15 * 60 * 1000;
const REQUIRED = ['@modelcontextprotocol/sdk', 'zod', '@huggingface/transformers'];
const INSTALLER = fileURLToPath(new URL('../scripts/install-deps.mjs', import.meta.url));

// Resolved the way Node resolves the real imports, so a hoisted install (npm,
// npx) counts as present. An export map that hides package.json still proves the
// package is there.
export function missingDependencies(root = ROOT) {
  const require = createRequire(join(root, 'package.json'));
  return REQUIRED.filter(name => {
    try { require.resolve(`${name}/package.json`); return false; }
    catch (err) { return err.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED'; }
  });
}

function lockHeld(root, now) {
  try { return now - statSync(join(root, INSTALL_LOCK)).mtimeMs < LOCK_STALE_MS; } catch { return false; }
}

function previousFailure(root) {
  try { return readFileSync(join(root, INSTALL_FAILED), 'utf8').trim() || 'unknown error'; } catch { return null; }
}

function startInstaller(root) {
  const child = spawn(process.execPath, [INSTALLER, root], { cwd: root, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

// { state: 'present' } or { state: 'installing', root, failed }: `failed` is the
// previous attempt's error, when there was one; this call has started another.
export function ensureDependencies({ root = ROOT, missing = missingDependencies, start = startInstaller, now = Date.now() } = {}) {
  if (!missing(root).length) return { state: 'present' };
  const failed = previousFailure(root);
  if (!lockHeld(root, now)) {
    try { start(root); } catch { return { state: 'installing', root, failed: failed ?? 'the installer could not be started' }; }
  }
  return { state: 'installing', root, failed };
}

// The command a person can run to install them by hand.
export function manualInstallCommand(root = ROOT) {
  return `cd "${root}" && npm ci --omit=dev --ignore-scripts`;
}
