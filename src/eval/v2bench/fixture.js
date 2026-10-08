import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

export const DEFAULT_FIXTURE = fileURLToPath(new URL('./fixtures/trial-events.json.gz', import.meta.url));

export async function loadFixture(path = DEFAULT_FIXTURE) {
  return JSON.parse(gunzipSync(await readFile(path)).toString('utf8'));
}
