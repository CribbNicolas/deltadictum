import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const DEFAULT_UI_URL = 'http://127.0.0.1:7733';

export function auditUiUrl(port = 7733) {
  return `http://127.0.0.1:${port}`;
}

export function sessionBanner({ projectId, url, activeCount = 0 }) {
  return [
    `DD - loaded for \`${projectId}\` (${activeCount} active).`,
    `DD - Audit UI: ${url}`,
  ].join('\n');
}

export function uiStatusPath(supermemDir) {
  return join(supermemDir, 'ui.json');
}

export async function writeUiUrl(supermemDir, { url, port }) {
  await mkdir(supermemDir, { recursive: true });
  await writeFile(uiStatusPath(supermemDir), `${JSON.stringify({ url, port }, null, 2)}\n`, 'utf8');
}

export async function readUiUrl(supermemDir) {
  try {
    const data = JSON.parse(await readFile(uiStatusPath(supermemDir), 'utf8'));
    if (typeof data.url === 'string' && data.url.trim()) return data.url.trim();
  } catch {
    // missing or invalid runtime file
  }
  return DEFAULT_UI_URL;
}
