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

export function uiStatusPath(ddDir) {
  return join(ddDir, 'ui.json');
}

export async function writeUiUrl(ddDir, { url, port }) {
  await mkdir(ddDir, { recursive: true });
  await writeFile(uiStatusPath(ddDir), `${JSON.stringify({ url, port }, null, 2)}\n`, 'utf8');
}

export async function readUiUrl(ddDir) {
  try {
    const data = JSON.parse(await readFile(uiStatusPath(ddDir), 'utf8'));
    if (typeof data.url === 'string' && data.url.trim()) return data.url.trim();
  } catch {
    // missing or invalid runtime file
  }
  return DEFAULT_UI_URL;
}
