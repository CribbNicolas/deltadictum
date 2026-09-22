import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_ID } from './hooks/build.js';

// One resident DD process per project (L2): the audit UI, answering hooks with
// semantic retrieval. It outlives sessions, is started by whichever session
// finds none, and is never required for a correct answer.
const CLI = fileURLToPath(new URL('./cli.js', import.meta.url));

async function uiRecord(repoRoot) {
  try { return JSON.parse(await readFile(join(repoRoot, '.dd', 'ui.json'), 'utf8')); } catch { return null; }
}

export async function residentStatus(repoRoot, timeoutMs = 500) {
  const record = await uiRecord(repoRoot);
  if (!record?.url) return null;
  try {
    const response = await fetch(`${record.url}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const status = await response.json();
    return { url: record.url, hookToken: record.hook_token, build: status.build ?? null, stale: status.stale !== false,
      retrieval: status.retrieval ?? 'lexical' };
  } catch { return null; }
}

// Live and running this build: nothing to do. Otherwise start one, detached, and
// do not wait for it; this session is served lexically until it answers.
export async function ensureResident(repoRoot, { start = startDetached } = {}) {
  // Opt-out for tests, CI and anyone who does not want a background process.
  if (process.env.DD_RESIDENT === '0') return { state: 'disabled' };
  const status = await residentStatus(repoRoot);
  // Same build but edited since it started: it refuses hooks (gap 7), so it is
  // replaced like a resident from another build.
  if (status && status.build === BUILD_ID && !status.stale) return { state: 'live', url: status.url, retrieval: status.retrieval };
  try { start(repoRoot); return { state: 'started', replaced: Boolean(status) }; }
  catch { return { state: 'unavailable' }; }
}

function startDetached(repoRoot) {
  const child = spawn(process.execPath, [CLI, 'ui'], { cwd: repoRoot, detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, DD_PROJECT_DIR: repoRoot } });
  child.unref();
}

// Ask a resident from another build to exit so this one can take the project.
export async function retireResident(status) {
  if (!status?.hookToken) return;
  try {
    await fetch(`${status.url}/api/shutdown`, { method: 'POST', headers: { 'x-dd-hook-token': status.hookToken },
      signal: AbortSignal.timeout(1000) });
  } catch { /* already gone */ }
}
