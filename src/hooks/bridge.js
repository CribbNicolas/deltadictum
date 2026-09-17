import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function callRunningStore(command, payload, repoRoot) {
  if (!['pre-tool', 'prompt', 'session-start'].includes(command)) return null;
  try {
    const status = JSON.parse(await readFile(join(repoRoot, '.dd', 'ui.json'), 'utf8'));
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(status.url) || !/^[a-f0-9]{64}$/.test(status.hook_token ?? '')) return null;
    const response = await fetch(`${status.url}/api/hooks/${command}`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dd-hook-token': status.hook_token },
      body: JSON.stringify({ payload, repo_root: repoRoot }), signal: AbortSignal.timeout(1500) });
    return response.ok ? await response.json() : null;
  } catch { return null; }
}
