import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_ID, VERSION, compareVersions, compatibleBuild } from './hooks/build.js';
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

// The registry holds the secrets that let a process answer hooks and open the
// audit UI, so only its owner may read it. The modes take effect on POSIX; on
// Windows the profile directory is already private to its user.
export async function writeRegistry({ url, port, hookToken, uiKey }) {
  const path = registryPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify({ url, port, hook_token: hookToken, ui_key: uiKey, pid: process.pid, build: BUILD_ID, version: VERSION }, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 });
  await rename(temp, path);
}

export async function residentStatus(timeoutMs = 500) {
  const record = await readRegistry();
  if (!record?.url) return null;
  try {
    const response = await fetch(`${record.url}/api/resident`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const status = await response.json();
    return { url: record.url, hookToken: record.hook_token, build: status.build ?? null, version: status.version ?? null, stale: status.stale !== false,
      retrieval: status.retrieval ?? 'lexical' };
  } catch { return null; }
}

// The audit UI address for one project, or null when no resident is recorded.
export async function projectUiUrl(repoRoot) {
  const record = await readRegistry();
  if (!record?.url) return null;
  const address = `${record.url}/?project=${encodeURIComponent(projectKey(repoRoot).key)}`;
  return record.ui_key ? `${address}&key=${record.ui_key}` : address;
}

// The audit UI address a session start may name, given what ensureResident
// found. Only a live resident has one: a resident just started (or replacing
// another) writes the registry once it listens, so until then the registry
// names the process it replaced, or one that is gone.
export async function sessionUiUrl(repoRoot, resident) {
  return resident?.state === 'live' ? projectUiUrl(repoRoot) : null;
}

// Whether a running resident serves this install: unchanged since it started
// (an edited one refuses hooks, gap 7), and from this tree or the same version,
// so installs of one version share it (L2). One of a newer version is left in
// place: replacing it only starts a fight with the install that started it,
// which would replace this one's at its next session start.
export function residentFit(status) {
  if (!status) return 'none';
  if (status.stale) return 'replace';
  if (compatibleBuild(status)) return 'live';
  return compareVersions(status.version, VERSION) > 0 ? 'superseded' : 'replace';
}

// Live and serving this install: nothing to do. Otherwise start one, detached,
// and do not wait for it; DD stays inactive for this session until it answers.
export async function ensureResident(_repoRoot, { start = startDetached } = {}) {
  // Opt-out for tests, CI and anyone who does not want a background process.
  if (process.env.DD_RESIDENT === '0') return { state: 'disabled' };
  const status = await residentStatus();
  const fit = residentFit(status);
  if (fit === 'live') return { state: 'live', url: status.url, retrieval: status.retrieval };
  if (fit === 'superseded') return { state: 'superseded', version: status.version };
  try { start(); return { state: 'started', replaced: Boolean(status) }; }
  catch { return { state: 'unavailable' }; }
}

function startDetached() {
  const child = spawn(process.execPath, [CLI, 'resident'], { cwd: homedir(), detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
}

// Ask a stale resident, or one of an older version, to exit so this one can take its place.
export async function retireResident(status) {
  if (!status?.hookToken) return;
  try {
    await fetch(`${status.url}/api/shutdown`, { method: 'POST', headers: { 'x-dd-hook-token': status.hookToken },
      signal: AbortSignal.timeout(1000) });
  } catch { /* already gone */ }
}
