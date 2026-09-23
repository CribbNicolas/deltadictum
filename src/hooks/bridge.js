import { BUILD_ID } from './build.js';
import { readRegistry } from '../resident.js';
import { projectDataDir } from '../project.js';

// pre-tool fires on every tool call (the L1 hot path); a slow or half-dead
// resident must not stall every tool call by as much as the other, far rarer,
// commands can tolerate. session-start/prompt fire at most once per turn/session,
// so they keep the more generous ceiling.
const PRE_TOOL_TIMEOUT_MS = 250;
const DEFAULT_TIMEOUT_MS = 1500;

// Ask the machine's resident process to answer for this project. It is shared
// by every project, so the request names the project root and the data
// directory this process would use (DD_DATA may place it inside the project).
// 'retrieve' is the MCP tool, answered here so it gets the same semantic
// retrieval as the hooks.
export async function callRunningStore(command, payload, repoRoot) {
  if (!['pre-tool', 'prompt', 'session-start', 'retrieve'].includes(command)) return null;
  try {
    const status = await readRegistry();
    if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(status?.url ?? '') || !/^[a-f0-9]{64}$/.test(status.hook_token ?? '')) return null;
    const response = await fetch(`${status.url}/api/hooks/${command}`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dd-hook-token': status.hook_token },
      body: JSON.stringify({ payload, repo_root: repoRoot, data_dir: projectDataDir(repoRoot) }),
      signal: AbortSignal.timeout(command === 'pre-tool' ? PRE_TOOL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS) });
    // A resident from another install, or one that predates this check, answers
    // without this build's id; its reply would carry its code, not ours (gap 7).
    if (!response.ok || response.headers.get('x-dd-build') !== BUILD_ID) return null;
    return await response.json();
  } catch { return null; }
}
