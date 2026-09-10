import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUiUrl, sessionBanner, writeUiUrl } from '../../src/hooks/banner.js';

describe('session banner', () => {
  test('always includes load line and audit URL', () => {
    const text = sessionBanner({
      projectId: 'supermem',
      url: 'http://127.0.0.1:7733',
      activeCount: 0,
    });
    assert.match(text, /DD - loaded for `supermem` \(0 active\)/);
    assert.match(text, /DD - Audit UI: http:\/\/127\.0\.0\.1:7733/);
    assert.doesNotMatch(text, /SuperMem|DeltaDictum/);
  });

  test('persists and reads the live audit URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'supermem-ui-url-'));
    const supermemDir = join(root, '.supermem');
    await writeUiUrl(supermemDir, { url: 'http://127.0.0.1:7734', port: 7734 });
    assert.equal(await readUiUrl(supermemDir), 'http://127.0.0.1:7734');
  });
});
