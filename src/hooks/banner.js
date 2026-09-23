import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_UI_URL = 'http://127.0.0.1:7733';

export function auditUiUrl(port = 7733) {
  return `http://127.0.0.1:${port}`;
}

// Shown to the person, not to the model: a bare URL on its own so the terminal
// linkifies it and the audit UI is one ctrl-click away.
export function uiPointer(url) {
  return `DD audit UI: ${url}`;
}

export function sessionBanner({ projectId, url, activeCount = 0 }) {
  return [
    `DD - loaded for \`${projectId}\` (${activeCount} active).`,
    // Explicit ask, not a passive fact: SessionStart output reaches the model
    // only, on every harness, so the model relaying it is the only path left
    // to the person. Phrased as an instruction because a neutral fact is a
    // judgment call the model can silently skip.
    url
      ? `DD - Audit UI: ${url} -- tell the user this URL near the start of your first reply this session, if you have not already.`
      // No live resident to name: a guessed or stale address sends the person to a refused connection.
      : 'DD - Audit UI: not running yet. The DD `ui` tool returns its address once the resident process is up.',
  ].join('\n');
}

export function uiStatusPath(ddDir) {
  return join(ddDir, 'ui.json');
}

export async function writeUiUrl(ddDir, { url, port, hookToken }) {
  await mkdir(ddDir, { recursive: true });
  await writeFile(uiStatusPath(ddDir), `${JSON.stringify({ url, port, ...(hookToken ? { hook_token: hookToken } : {}) }, null, 2)}\n`, 'utf8');
}

// The URL an audit UI actually recorded, or null when none ever did. The
// model-facing banner always names somewhere to look, so `readUiUrl` keeps
// defaulting; a pointer put in front of the person must not name a dead port.
export async function recordedUiUrl(ddDir) {
  try {
    const data = JSON.parse(await readFile(uiStatusPath(ddDir), 'utf8'));
    if (typeof data.url === 'string' && data.url.trim()) return data.url.trim();
  } catch {
    // missing or invalid runtime file
  }
  return null;
}

export async function readUiUrl(ddDir) {
  return (await recordedUiUrl(ddDir)) ?? DEFAULT_UI_URL;
}

// `ui.json` survives the process that wrote it, so a recorded URL is a claim
// about the past. Probing is what makes the pointer true today. A failure means
// "do not offer the link", never a failed hook (L5).
export async function probeUi(url, timeoutMs = 500) {
  try {
    const response = await fetch(`${url}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
    return response.ok;
  } catch {
    return false;
  }
}
