import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readUiUrl, sessionBanner, writeUiUrl } from '../../src/hooks/banner.js';

describe('session banner', () => {
  test('always includes load line and audit URL', () => {
    const text = sessionBanner({
      projectId: 'demo',
      url: 'http://127.0.0.1:7733',
      activeCount: 0,
    });
    assert.match(text, /DD - loaded for `demo` \(0 active\)/);
    assert.match(text, /DD - Audit UI: http:\/\/127\.0\.0\.1:7733/);
    assert.doesNotMatch(text, /DeltaDictum/);
  });

  test('persists and reads the live audit URL', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dd-ui-url-'));
    const ddDir = join(root, '.dd');
    await writeUiUrl(ddDir, { url: 'http://127.0.0.1:7734', port: 7734 });
    assert.equal(await readUiUrl(ddDir), 'http://127.0.0.1:7734');
  });
});
