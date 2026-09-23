import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_ID } from './hooks/build.js';
import { projectKey } from './project.js';

// One resident DD process per machine (L2), shared by every project and
// session: it holds the embedding model once and answers hooks and the audit
// UI for each project from that project's own store. It is found through one
// registry file, not per project.
const CLI = fileURLToPath(new URL('./cli.js', import.meta.url));

export function registryPath() {
  return process.env.DD_RESIDENT_REGISTRY || join(homedir(), '.dd-data', 'resident.json');
}

export async function readRegistry() {
  try { return JSON.parse(await readFile(registryPath(), 'utf8')); } catch { return null; }
}

export async function writeRegistry({ url, port, hookToken }) {
  const path = registryPath();
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ url, port, hook_token: hookToken, pid: process.pid, build: BUILD_ID }, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export async function residentStatus(timeoutMs = 500) {
  const record = await readRegistry();
  if (!record?.url) return null;
  try {
    const response = await fetch(`${record.url}/api/resident`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const status = await response.json();
    return { url: record.url, hookToken: record.hook_token, build: status.build ?? null, stale: status.stale !== false,
      retrieval: status.retrieval ?? 'lexical' };
  } catch { return null; }
}

// The audit UI address for one project, or null when no resident is recorded.
export async function projectUiUrl(repoRoot) {
  const record = await readRegistry();
  return record?.url ? `${record.url}/?project=${encodeURIComponent(projectKey(repoRoot).key)}` : null;
}

// Live and running this build: nothing to do. Otherwise start one, detached, and
// do not wait for it; DD stays inactive for this session until it answers.
export async function ensureResident(_repoRoot, { start = startDetached } = {}) {
  // Opt-out for tests, CI and anyone who does not want a background process.
  if (process.env.DD_RESIDENT === '0') return { state: 'disabled' };
  const status = await residentStatus();
  // Same build but edited since it started: it refuses hooks (gap 7), so it is
  // replaced like a resident from another build.
  if (status && status.build === BUILD_ID && !status.stale) return { state: 'live', url: status.url, retrieval: status.retrieval };
  try { start(); return { state: 'started', replaced: Boolean(status) }; }
  catch { return { state: 'unavailable' }; }
}

function startDetached() {
  const child = spawn(process.execPath, [CLI, 'resident'], { cwd: homedir(), detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

// Ask a resident from another build to exit so this one can take its place.
export async function retireResident(status) {
  if (!status?.hookToken) return;
  try {
    await fetch(`${status.url}/api/shutdown`, { method: 'POST', headers: { 'x-dd-hook-token': status.hookToken },
      signal: AbortSignal.timeout(1000) });
  } catch { /* already gone */ }
}
